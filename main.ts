/*
 * AI Life Assistant Plugin for Obsidian
 * Copyright (c) 2025 Matthew Chang, Jerry Kim
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  App,
  Editor,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  MarkdownFileInfo,
  Component, // Added for MarkdownRenderer context
  TFolder, // For listing folders
} from "obsidian";

const AI_ASSISTANT_VIEW_TYPE = "ai-life-assistant-view";

interface AiLifeAssistantSettings {
  openAiApiKey: string;
  defaultModel: string;
}

const DEFAULT_SETTINGS: AiLifeAssistantSettings = {
  openAiApiKey: "",
  defaultModel: "gpt-4o-mini",
};

// Heuristic: Average characters per token. Adjust as needed.
const CHARS_PER_TOKEN = 3.5; // A bit more conservative than 4
const MAX_CONTEXT_TOKENS = 15000; // Max tokens for combined context + prompt (leaves room for system prompt & response)

async function callChatGPT(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  context: string = ""
): Promise<string> {
  const fullPrompt = context ? `${context}\n\n${userPrompt}` : userPrompt;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("OpenAI API Error:", errorData);
      throw new Error(
        `OpenAI API Error: ${response.status} ${
          errorData?.error?.message || "Unknown error"
        }`
      );
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      return data.choices[0].message.content.trim();
    } else {
      console.error("Unexpected API response structure:", data);
      throw new Error("Unexpected API response structure from OpenAI.");
    }
  } catch (error) {
    console.error("Error calling ChatGPT:", error);
    throw error;
  }
}

class AiAssistantView extends ItemView {
  plugin: AiLifeAssistantPlugin;
  private promptInputEl: HTMLTextAreaElement;
  private responseDivEl: HTMLDivElement;
  private folderSelectEl: HTMLSelectElement;
  private tokenWarningEl: HTMLParagraphElement;
  private concatenatedFilesListEl: HTMLDivElement; // For displaying concatenated file names

  private currentContextContent: string = "";

  constructor(leaf: WorkspaceLeaf, plugin: AiLifeAssistantPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return AI_ASSISTANT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI Assistant";
  }

  getIcon(): string {
    return "brain-cog";
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  async onOpen() {
    const container = this.contentEl; // ItemView provides contentEl directly
    container.empty();

    container.createEl("h4", { text: "AI Life Assistant" });

    const inputRow = container.createDiv({ cls: "ai-input-row" });
    // Folder select dropdown
    const folderSelectContainer = inputRow.createDiv({
      cls: "ai-folder-select-container",
    });
    folderSelectContainer.style.marginBottom = "10px";
    folderSelectContainer.createEl("label", {
      text: "Context Folder:",
      cls: "ai-folder-label",
    }).style.marginRight = "5px";

    this.folderSelectEl = folderSelectContainer.createEl("select");
    this.folderSelectEl.style.marginRight = "10px";
    this.populateFolderDropdown();
    this.folderSelectEl.addEventListener("change", () =>
      this.handleFolderSelectionChange()
    );

    // Input row for prompt and button
    const promptArea = container.createDiv({ cls: "ai-prompt-area" });
    promptArea.style.display = "flex";
    promptArea.style.alignItems = "flex-end";
    promptArea.style.gap = "8px";
    promptArea.style.marginBottom = "5px";

    this.promptInputEl = promptArea.createEl("textarea", {
      attr: { placeholder: "Enter your prompt for the AI..." },
    });
    this.promptInputEl.style.flexGrow = "1";
    this.promptInputEl.style.minHeight = "40px";
    this.promptInputEl.style.maxHeight = "200px";
    this.promptInputEl.style.resize = "vertical";
    this.promptInputEl.rows = 1;

    this.promptInputEl.addEventListener("input", () => {
      this.promptInputEl.style.height = "auto"; // Reset height
      this.promptInputEl.style.height = `${this.promptInputEl.scrollHeight}px`;
      this.updateTokenWarning();
    });

    const submitButton = promptArea.createEl("button", { text: "Ask AI" });
    submitButton.style.height = "min-content"; // Adjust button height to content

    // Token warning display
    this.tokenWarningEl = container.createEl("p", { cls: "ai-token-warning" });
    this.tokenWarningEl.style.color = "var(--text-error)";
    this.tokenWarningEl.style.fontSize = "0.9em";
    this.tokenWarningEl.style.display = "none"; // Hidden by default
    this.tokenWarningEl.style.marginBottom = "10px";

    // Concatenated files list display (for debugging)
    this.concatenatedFilesListEl = container.createDiv({
      cls: "ai-concatenated-files-list",
    });
    this.concatenatedFilesListEl.style.fontSize = "0.85em";
    this.concatenatedFilesListEl.style.color = "var(--text-muted)";
    this.concatenatedFilesListEl.style.maxHeight = "100px"; // Limit height
    this.concatenatedFilesListEl.style.overflowY = "auto"; // Add scroll if many files
    this.concatenatedFilesListEl.style.border =
      "1px dashed var(--background-modifier-border)";
    this.concatenatedFilesListEl.style.padding = "5px";
    this.concatenatedFilesListEl.style.marginBottom = "10px";
    this.concatenatedFilesListEl.setText("No context files loaded yet."); // Initial text

    // Response display area
    this.responseDivEl = container.createDiv({ cls: "ai-response-area" });
    this.responseDivEl.style.marginTop = "8px";
    this.responseDivEl.style.borderTop =
      "1px solid var(--background-modifier-border)";
    this.responseDivEl.style.paddingTop = "8px";
    this.responseDivEl.style.maxHeight = "calc(100vh - 300px)"; // Adjusted max height
    this.responseDivEl.style.overflowY = "auto";

    // Old inputRow styling (if needed for other elements, otherwise remove)
    inputRow.style.display = "flex";
    inputRow.style.alignItems = "flex-end";
    inputRow.style.gap = "8px";
    inputRow.style.marginBottom = "10px";

    const handleSubmit = async () => {
      const userPromptText = this.promptInputEl.value;
      if (!userPromptText.trim()) {
        new Notice("Please enter a prompt.");
        return;
      }

      const totalTokens = this.estimateTokens(
        this.currentContextContent + userPromptText
      );
      if (totalTokens > MAX_CONTEXT_TOKENS) {
        new Notice(
          "Error: Combined context and prompt exceed token limit. Please shorten or select a smaller folder."
        );
        this.tokenWarningEl.setText(
          `Token limit exceeded! Current: ~${totalTokens} (Max: ${MAX_CONTEXT_TOKENS}). Shorten prompt or context.`
        );
        this.tokenWarningEl.style.display = "block";
        return;
      }

      try {
        new Notice("AI에게 물어보는 중...");
        this.responseDivEl.empty(); // Clear previous response
        const systemPrompt =
          "You are a helpful AI assistant. Please format your response in Markdown.";
        const response = await this.plugin.callOpenAI(
          systemPrompt,
          userPromptText,
          this.currentContextContent
        );

        // Use 'this' (the ItemView instance) as the component context for MarkdownRenderer
        await MarkdownRenderer.renderMarkdown(
          response,
          this.responseDivEl,
          this.app.vault.getRoot().path, // Base path for relative links
          this as Component // Cast to Component
        );

        this.promptInputEl.value = ""; // Clear input
        this.promptInputEl.style.height = "auto"; // Reset height
        this.promptInputEl.rows = 1;
        this.promptInputEl.focus(); // Focus back on input
        this.updateTokenWarning(); // Reset token warning if prompt is cleared
      } catch (error: any) {
        this.responseDivEl.empty();
        if (error.message !== "OpenAI API Key not set.") {
          console.error("Error interacting with AI from panel:", error);
          new Notice(`Error: ${error.message}. Check console for details.`);
        }
        const errorP = this.responseDivEl.createEl("p", {
          text: `Error: ${error.message}`,
          cls: "ai-error-message",
        });
        errorP.style.color = "var(--text-error)";
      }
    };

    submitButton.addEventListener("click", handleSubmit);

    this.promptInputEl.addEventListener(
      "keydown",
      async (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault(); // Prevent new line
          await handleSubmit();
        }
      }
    );

    this.updateTokenWarning(); // Initial check
    // Focus the input field when the view is opened
    setTimeout(() => this.promptInputEl.focus(), 50);
  }

  private populateFolderDropdown(): void {
    this.folderSelectEl.empty();
    this.folderSelectEl.createEl("option", {
      text: "No folder selected",
      value: "",
    });

    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f) => f instanceof TFolder) as TFolder[];
    folders.sort((a, b) => a.path.localeCompare(b.path)); // Sort folders by path

    for (const folder of folders) {
      // Exclude .obsidian folder and its subfolders
      if (folder.path === ".obsidian" || folder.path.startsWith(".obsidian/")) {
        continue;
      }
      this.folderSelectEl.createEl("option", {
        text: folder.path,
        value: folder.path,
      });
    }
  }

  private async handleFolderSelectionChange(): Promise<void> {
    const selectedPath = this.folderSelectEl.value;
    if (selectedPath) {
      new Notice(`Loading context from folder: ${selectedPath}...`);
      await this.loadContextFromFolder(selectedPath);
    } else {
      this.currentContextContent = "";
      this.updateConcatenatedFilesList([]); // Clear the list
      this.updateTokenWarning();
    }
  }

  private async loadContextFromFolder(folderPath: string): Promise<void> {
    let concatenatedContent = "";
    let currentTokens = 0;
    const loadedFileNames: string[] = []; // To store names of loaded files

    const filesInFolder = this.app.vault.getMarkdownFiles().filter((file) => {
      // Ensure it's directly in the selected folder, not in subfolders
      return file.parent && file.parent.path === folderPath;
    });

    // Sort files, e.g., by name, to have a consistent order
    filesInFolder.sort((a, b) => a.name.localeCompare(b.name));

    for (const file of filesInFolder) {
      const fileContent = await this.app.vault.cachedRead(file);
      const fileTokens = this.estimateTokens(fileContent);

      if (
        currentTokens +
          fileTokens +
          this.estimateTokens(this.promptInputEl.value) >
        MAX_CONTEXT_TOKENS
      ) {
        new Notice(
          `Stopped adding files to context to avoid exceeding token limit. Last file added: ${
            concatenatedContent ? "previous files" : "none"
          }. Current file skipped: ${file.name}`
        );
        break; // Stop adding more files if limit is about to be breached
      }
      concatenatedContent += fileContent + "\n\n---\n\n"; // Add separator
      currentTokens += fileTokens + this.estimateTokens("\n\n---\n\n");
      loadedFileNames.push(file.name); // Add file name to the list
    }
    this.currentContextContent = concatenatedContent;
    this.updateConcatenatedFilesList(loadedFileNames); // Update the displayed list
    this.updateTokenWarning();
    if (concatenatedContent) {
      new Notice(
        `Context loaded from ${folderPath}. Estimated context tokens: ~${this.estimateTokens(
          this.currentContextContent
        )}`
      );
    }
  }

  private updateConcatenatedFilesList(fileNames: string[]): void {
    this.concatenatedFilesListEl.empty(); // Clear previous list
    if (fileNames.length === 0) {
      this.concatenatedFilesListEl.setText(
        "No context files loaded from selected folder."
      );
      return;
    }
    this.concatenatedFilesListEl.createEl("strong", { text: "Context Files:" });
    const ul = this.concatenatedFilesListEl.createEl("ul");
    fileNames.forEach((name) => ul.createEl("li", { text: name }));
  }

  private updateTokenWarning(): void {
    const promptTokens = this.estimateTokens(this.promptInputEl.value);
    const contextTokens = this.estimateTokens(this.currentContextContent);
    const totalUserTokens = promptTokens + contextTokens;

    this.tokenWarningEl.setText(
      `Context: ~${contextTokens} tokens. Prompt: ~${promptTokens} tokens. Total: ~${totalUserTokens} / ${MAX_CONTEXT_TOKENS} tokens.`
    );
    this.tokenWarningEl.style.display = totalUserTokens > 0 ? "block" : "none";
    this.tokenWarningEl.style.color =
      totalUserTokens > MAX_CONTEXT_TOKENS
        ? "var(--text-error)"
        : "var(--text-muted)";
  }

  async onClose() {
    // Nothing to clean up yet
  }
}

export default class AiLifeAssistantPlugin extends Plugin {
  settings: AiLifeAssistantSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(
      AI_ASSISTANT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new AiAssistantView(leaf, this)
    );

    this.addRibbonIcon("brain-cog", "Toggle AI Assistant Panel", () => {
      this.activateView();
    });

    this.addCommand({
      id: "toggle-ai-assistant-panel",
      name: "Toggle AI Assistant Panel",
      callback: () => {
        this.activateView();
      },
    });

    this.addCommand({
      id: "summarize-selection-chatgpt",
      name: "Summarize selection with ChatGPT",
      editorCallback: async (
        editor: Editor,
        view: MarkdownView | MarkdownFileInfo
      ) => {
        const selectedText = editor.getSelection();
        if (!selectedText) {
          new Notice("No text selected.");
          return;
        }
        if (!this.settings.openAiApiKey) {
          new Notice(
            "OpenAI API Key not set. Please configure it in the plugin settings."
          );
          return;
        }

        try {
          new Notice("Summarizing with ChatGPT...");
          const systemPrompt =
            "You are a helpful assistant that summarizes text concisely.";
          const userPrompt = "Please summarize the following text:";
          const summary = await callChatGPT(
            this.settings.openAiApiKey,
            this.settings.defaultModel,
            systemPrompt,
            userPrompt,
            selectedText
          );
          editor.replaceSelection(summary);
          new Notice("Summary complete!");
        } catch (error: any) {
          console.error("Error summarizing with ChatGPT:", error);
          new Notice(
            `Error summarizing: ${error.message}. Check console for details.`
          );
        }
      },
    });

    this.addSettingTab(new AiLifeAssistantSettingTab(this.app, this));
    console.log("AI Life Assistant plugin loaded.");
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(AI_ASSISTANT_VIEW_TYPE);
    console.log("AI Life Assistant plugin unloaded.");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async callOpenAI(
    systemPrompt: string,
    userPrompt: string,
    context: string = ""
  ): Promise<string> {
    if (!this.settings.openAiApiKey) {
      new Notice(
        "OpenAI API Key not set. Please configure it in the plugin settings."
      );
      throw new Error("OpenAI API Key not set.");
    }
    return callChatGPT(
      this.settings.openAiApiKey,
      this.settings.defaultModel,
      systemPrompt,
      userPrompt,
      context
    );
  }

  async activateView() {
    if (this.app.workspace.getLeavesOfType(AI_ASSISTANT_VIEW_TYPE).length > 0) {
      this.app.workspace.detachLeavesOfType(AI_ASSISTANT_VIEW_TYPE);
      return;
    }
    const rightLeaf = this.app.workspace.getRightLeaf(false);
    if (rightLeaf) {
      await rightLeaf.setViewState({
        type: AI_ASSISTANT_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(rightLeaf); // Reveal the leaf we just set
    } else {
      new Notice("Could not open AI Assistant Panel in the right sidebar.");
    }
  }
}

class AiLifeAssistantSettingTab extends PluginSettingTab {
  plugin: AiLifeAssistantPlugin;

  constructor(app: App, plugin: AiLifeAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI Life Assistant Settings" });

    new Setting(containerEl)
      .setName("OpenAI API Key")
      .setDesc("Enter your OpenAI API key to use ChatGPT features.")
      .addText((text) =>
        text
          .setPlaceholder("sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
          .setValue(this.plugin.settings.openAiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAiApiKey = value;
            await this.plugin.saveSettings();
          })
      );

			new Setting(containerEl)
  .setName("Default Model")
  .setDesc("Select the default ChatGPT model to use.")
  .addDropdown((dropdown) =>
    dropdown
      .addOption("o4-mini", "o4-mini")
      .addOption("gpt-4.1-mini", "gpt-4.1-mini")
      .addOption("gpt-4.1-nano", "gpt-4.1-nano")
      .addOption("gpt-4o-mini", "gpt-4o-mini")
      .setValue(this.plugin.settings.defaultModel)
      .onChange(async (value) => {
        this.plugin.settings.defaultModel = value;
        await this.plugin.saveSettings();
      })
  );
  }
}
