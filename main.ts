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
  TFile, // For file operations
  TFolder, // For listing folders
} from "obsidian";

const AI_ASSISTANT_VIEW_TYPE = "ai-life-assistant-view";

interface AiLifeAssistantSettings {
  openAiApiKey: string;
  defaultModel: string;
  promptFilePath: string; // Path to the default selected prompt file
  promptFilesFolderPath: string; // Path to the folder containing prompt files
  chatHistory: ConversationEntry[]; // To store conversation history
}

const DEFAULT_SETTINGS: AiLifeAssistantSettings = {
  openAiApiKey: "",
  defaultModel: "gpt-4o-mini",
  promptFilePath: "", // Default to no prompt file selected
  promptFilesFolderPath: "", // Default to no specific prompt folder (list all MD files)
  chatHistory: [], // Initialize with an empty history
};

interface ConversationEntry {
  timestamp: number;
  userPrompt: string;
  aiResponse: string;
}

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
  private promptFileSelectEl: HTMLSelectElement; // For selecting a prompt file
  private folderLabelEl: HTMLLabelElement; // To dynamically change label
  private promptFileLabelEl: HTMLLabelElement; // To dynamically change label
  private tokenWarningEl: HTMLParagraphElement;
  private concatenatedFilesListEl: HTMLDivElement; // For displaying concatenated file names
  private submitButtonEl: HTMLButtonElement; // To manage button state
  private thinkingPEl: HTMLParagraphElement | null = null; // To keep track of the "Thinking..." p element

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
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%"; // Ensure container takes full view height

    // --- Response Section (Top 80%) ---
    const responseSectionDiv = container.createDiv({ cls: "ai-response-section" });
    responseSectionDiv.style.flex = "6"; // Takes 6 parts of 10 (60%)
    responseSectionDiv.style.overflowY = "auto";
    responseSectionDiv.style.display = "flex"; // To allow responseDivEl to grow
    responseSectionDiv.style.flexDirection = "column";

    this.responseDivEl = responseSectionDiv.createDiv({ cls: "ai-response-area" });
    this.responseDivEl.style.flexGrow = "1"; // Takes all available space in responseSectionDiv
    this.responseDivEl.style.padding = "8px"; // General padding for content
    this.responseDivEl.style.overflowY = "auto"; // Scroll for actual response content if very long

    // --- Input Section (Bottom 20%) ---
    const inputSectionDiv = container.createDiv({ cls: "ai-input-section" });
    inputSectionDiv.style.flex = "4"; // Takes 4 parts of 10 (40%)
    inputSectionDiv.style.overflowY = "auto"; // Scrollable if content overflows
    inputSectionDiv.style.padding = "10px";
    inputSectionDiv.style.borderTop = "1px solid var(--background-modifier-border)";

    // Add Title to Input Section
    inputSectionDiv.createEl("h5", { text: "AI Life Assistant" });

    // --- Context Folder Selection (in Input Section) ---
    const folderSelectContainer = inputSectionDiv.createDiv({
      cls: "ai-folder-select-container",
    });
    folderSelectContainer.style.display = "flex";
    folderSelectContainer.style.alignItems = "center";
    folderSelectContainer.style.marginBottom = "10px"; // Space below this row

    this.folderLabelEl = folderSelectContainer.createEl("label", { // Now child of inputSectionDiv
      text: "Context Folder:",
      cls: "ai-folder-label",
    });
    this.folderLabelEl.style.marginRight = "5px";

    this.folderSelectEl = folderSelectContainer.createEl("select");
    this.populateFolderDropdown();
    this.folderSelectEl.addEventListener("change", () =>
      this.handleFolderSelectionChange()
    );

    // --- Prompt File Selection (in Input Section) ---
    const promptFileSelectContainer = inputSectionDiv.createDiv({
      cls: "ai-prompt-file-select-container",
    });
    promptFileSelectContainer.style.display = "flex";
    promptFileSelectContainer.style.alignItems = "center";
    promptFileSelectContainer.style.marginBottom = "10px"; // Space below this row

    this.promptFileLabelEl = promptFileSelectContainer.createEl("label", { // Now child of inputSectionDiv
      text: "Select Prompt File:",
      cls: "ai-prompt-file-label",
    });
    this.promptFileLabelEl.style.marginRight = "5px";

    this.promptFileSelectEl = promptFileSelectContainer.createEl("select");
    this.populatePromptFileDropdown();
    this.promptFileSelectEl.addEventListener("change", () =>
      this.handlePromptFileSelectionChange()
    );

    // --- Prompt Input Area (in Input Section) ---
    const promptArea = inputSectionDiv.createDiv({ cls: "ai-prompt-area" });
    promptArea.style.display = "flex";
    promptArea.style.alignItems = "flex-end";
    promptArea.style.gap = "8px";
    promptArea.style.marginBottom = "5px";

    this.promptInputEl = promptArea.createEl("textarea", { // Now child of inputSectionDiv
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

    this.submitButtonEl = promptArea.createEl("button", { text: "Ask AI" }); // Now child of inputSectionDiv
    this.submitButtonEl.style.height = "min-content"; // Adjust button height to content

    // --- Token Warning Display (in Input Section) ---
    this.tokenWarningEl = inputSectionDiv.createEl("p", { cls: "ai-token-warning" });
    this.tokenWarningEl.style.color = "var(--text-error)";
    this.tokenWarningEl.style.fontSize = "0.9em";
    this.tokenWarningEl.style.display = "none"; // Hidden by default
    this.tokenWarningEl.style.marginBottom = "10px";

    // Concatenated files list display (in Input Section)
    const concatenatedFilesDisplayRow = inputSectionDiv.createDiv({
      cls: "ai-input-row concatenated-files-display-row",
    });
    concatenatedFilesDisplayRow.style.display = "flex"; // Keep this styling for the row itself
    concatenatedFilesDisplayRow.style.alignItems = "flex-start";
    concatenatedFilesDisplayRow.style.marginBottom = "10px";

    this.concatenatedFilesListEl = concatenatedFilesDisplayRow.createDiv({ // Now child of inputSectionDiv
      cls: "ai-concatenated-files-list",
    });
    this.concatenatedFilesListEl.style.fontSize = "0.85em";
    this.concatenatedFilesListEl.style.color = "var(--text-muted)";
    this.concatenatedFilesListEl.style.maxHeight = "100px"; // Limit height
    this.concatenatedFilesListEl.style.overflowY = "auto"; // Add scroll if many files
    this.concatenatedFilesListEl.style.border = "1px dashed var(--background-modifier-border)";
    this.concatenatedFilesListEl.style.padding = "5px";
    // this.concatenatedFilesListEl.style.marginBottom = "10px"; // Parent row handles bottom margin
    this.concatenatedFilesListEl.setText("No context files loaded yet."); // Initial text

    // --- Handle Submit ---
    const handleSubmit = async () => {
      const originalButtonText = this.submitButtonEl.textContent;
      this.submitButtonEl.textContent = "Thinking...";
      this.setUIEnabled(false);
      
      const isFirstUserInteractionInSession = this.plugin.settings.chatHistory.length === 0 && 
                                              !this.responseDivEl.querySelector('.conversation-entry');

      if (isFirstUserInteractionInSession) {
        this.responseDivEl.empty(); // Clear welcome message
      }

      // Remove previous "Thinking..." if it exists (e.g. from a quick re-submit or error)
      if (this.thinkingPEl && this.thinkingPEl.parentElement === this.responseDivEl) {
        this.thinkingPEl.remove();
        this.thinkingPEl = null;
      }

      // Display "Thinking..."
      this.thinkingPEl = this.responseDivEl.createEl("p", {
        text: "Thinking...",
      });
      this.thinkingPEl.addClass("ai-thinking-message");
      this.thinkingPEl.style.fontStyle = "italic";
      this.thinkingPEl.style.textAlign = "center";
      this.thinkingPEl.style.padding = "10px";

      const userPromptText = this.promptInputEl.value;
      if (!userPromptText.trim()) {
        new Notice("Please enter a prompt.");
        if (this.thinkingPEl && this.thinkingPEl.parentElement) { this.thinkingPEl.remove(); this.thinkingPEl = null; }
        this.submitButtonEl.textContent = originalButtonText;
        this.setUIEnabled(true);
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
        if (this.thinkingPEl && this.thinkingPEl.parentElement) { this.thinkingPEl.remove(); this.thinkingPEl = null; }
        this.submitButtonEl.textContent = originalButtonText;
        this.setUIEnabled(true);
        return;
      }

      try {
        const systemPrompt =
          "You are a helpful AI assistant. Please format your response in Markdown.";
        
        const rawMarkdownResponse = await this.plugin.callOpenAI(
          systemPrompt,
          userPromptText,
          this.currentContextContent
        );

        if (this.thinkingPEl && this.thinkingPEl.parentElement) { this.thinkingPEl.remove(); this.thinkingPEl = null; }

        const newEntry: ConversationEntry = {
          timestamp: Date.now(),
          userPrompt: userPromptText,
          aiResponse: rawMarkdownResponse,
        };

        this.plugin.settings.chatHistory.push(newEntry);
        await this.plugin.saveSettings();
        
        this.renderConversationEntry(newEntry, true); // Append and scroll

        this.promptInputEl.value = ""; // Clear input
        this.promptInputEl.style.height = "auto"; // Reset height
        this.promptInputEl.rows = 1;
        this.updateTokenWarning(); // Reset token warning if prompt is cleared
      } catch (error: any) {
        if (this.thinkingPEl && this.thinkingPEl.parentElement) { this.thinkingPEl.remove(); this.thinkingPEl = null; }

        if (error.message !== "OpenAI API Key not set.") {
          console.error("Error interacting with AI from panel:", error);
          new Notice(`Error: ${error.message}. Check console for details.`);
        }
        const errorP = this.responseDivEl.createEl("p", {
          text: `Error: ${error.message}`,
          cls: "ai-error-message",
        });
        errorP.style.padding = "10px";
        errorP.style.color = "var(--text-error)";
      } finally {
        if (this.thinkingPEl && this.thinkingPEl.parentNode === this.responseDivEl) { this.thinkingPEl.remove(); this.thinkingPEl = null; } // Ensure thinking is gone
        this.submitButtonEl.textContent = originalButtonText;
        this.setUIEnabled(true);
        this.promptInputEl.focus(); // Focus back on input
      }
    };

    this.submitButtonEl.addEventListener("click", handleSubmit);

    this.promptInputEl.addEventListener(
      "keydown",
      async (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault(); // Prevent new line
          await handleSubmit();
        }
      }
    );

    // Initial setup after populating dropdowns and attaching listeners:
    // 1. Load prompt from settings if available (and if it exists)
    // This is the only place settings.promptFilePath is used for initial prompt.
    if (this.plugin.settings.promptFilePath) {
      const defaultPromptFile = this.app.vault.getAbstractFileByPath(
        this.plugin.settings.promptFilePath
      );
      if (
        defaultPromptFile instanceof TFile &&
        defaultPromptFile.extension === "md"
      ) {
        const optionExists = Array.from(this.promptFileSelectEl.options).some(
          (opt) => opt.value === defaultPromptFile.path
        );
        if (optionExists) {
          this.promptFileSelectEl.value = defaultPromptFile.path;
          await this.handlePromptFileSelectionChange(); // Explicitly load content
        }
      }
    } // If not set or not found, it will just use the default "Prompt file location"

    // 2. Sync with the current active file (or lack thereof)
    const currentActiveFile = this.app.workspace.getActiveFile();
    await this.syncWithActiveFile(
      currentActiveFile instanceof TFile ? currentActiveFile : null
    );

    this.loadAndDisplayHistory(); // Load and display history or initial message

    // Ensure labels are correct after initial sync and potential settings load
    this.updateLabelForFolderSelect();
    this.updateLabelForPromptFileSelect();
    this.updateTokenWarning(); // Initial token check after potential loads

    // Register event listener for active leaf changes
    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        this.handleActiveLeafChange.bind(this)
      )
    );

    // Focus the input field when the view is opened
    setTimeout(() => this.promptInputEl.focus(), 50);
  }

  private setUIEnabled(enabled: boolean): void {
    this.promptInputEl.disabled = !enabled;
    this.submitButtonEl.disabled = !enabled;
    this.folderSelectEl.disabled = !enabled;
    this.promptFileSelectEl.disabled = !enabled;
  }

  private async renderConversationEntry(entry: ConversationEntry, isNewest: boolean = false) {
    const entryContainer = this.responseDivEl.createDiv({ cls: "conversation-entry" });
    entryContainer.style.marginBottom = "20px";
    entryContainer.style.padding = "10px";
    entryContainer.style.border = "1px solid var(--background-modifier-border-hover)";
    entryContainer.style.borderRadius = "5px";

    // User Prompt
    const userPromptDiv = entryContainer.createDiv({ cls: "user-prompt-entry" });
    userPromptDiv.createEl("strong", { text: "You:" });
    const userP = userPromptDiv.createEl("p", { text: entry.userPrompt });
    userP.style.whiteSpace = "pre-wrap"; // Preserve line breaks
    userP.style.marginTop = "5px";

    // AI Response
    const aiResponseDiv = entryContainer.createDiv({ cls: "ai-response-entry" });
    aiResponseDiv.style.marginTop = "10px";
    aiResponseDiv.createEl("strong", { text: "AI:" });
    const aiResponseContentDiv = aiResponseDiv.createDiv();
    aiResponseContentDiv.style.marginTop = "5px";

    await MarkdownRenderer.renderMarkdown(
      entry.aiResponse,
      aiResponseContentDiv,
      this.app.vault.getRoot().path,
      this as Component
    );

    // Add Copy button for AI Response
    const copyButtonContainer = aiResponseDiv.createDiv({ cls: "ai-response-copy-button-container" });
    copyButtonContainer.style.textAlign = "right";
    copyButtonContainer.style.marginTop = "10px";
    const copyButton = copyButtonContainer.createEl("button", { text: "Copy" });
    copyButton.addClass("mod-cta");
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry.aiResponse);
        new Notice("Response copied to clipboard!");
      } catch (err) {
        console.error("Failed to copy response: ", err);
        new Notice("Failed to copy response.");
      }
    });

    if (isNewest) {
      // Scroll the main response section to the bottom to show the new entry
      const responseSection = this.responseDivEl.parentElement; // This should be responseSectionDiv
      if (responseSection) {
        responseSection.scrollTop = responseSection.scrollHeight;
      }
    }
  }

  private displayInitialMessage(): void {
    if (!this.responseDivEl) return;
    this.responseDivEl.empty();

    this.responseDivEl.createEl("h4", { text: "Welcome to AI Life Assistant!"});

    const p1 = this.responseDivEl.createEl("p");
    p1.innerHTML = `며Select a <strong>Context Folder</strong> from the options below. The content of the files within this folder (up to the token limit of ~${MAX_CONTEXT_TOKENS}) will be combined with your prompt to provide context to the AI.`;
    p1.style.marginBottom = "10px";

    const p2 = this.responseDivEl.createEl("p");
    p2.innerHTML = `You can set a <strong>Default Prompt File</strong> and a specific <strong>Prompt Files Folder</strong> in the plugin settings (click the gear icon in Obsidian's sidebar) for quicker access to your favorite prompts.`;
    p2.style.marginBottom = "10px";

    const p3 = this.responseDivEl.createEl("p");
    p3.innerHTML = `If no <strong>Context Folder</strong> is selected, the content of the <strong>currently active Markdown file</strong> will automatically be used as context for your prompts.`;
    p3.style.marginBottom = "10px";

    const p4 = this.responseDivEl.createEl("p");
    p4.setText("Enter your query in the prompt box below and click 'Ask AI' or press Enter.");
    p4.style.marginTop = "15px";
    p4.style.fontStyle = "italic";

    // Style the overall message container if needed
    this.responseDivEl.style.padding = "15px";
    this.responseDivEl.style.color = "var(--text-normal)";
    this.responseDivEl.findAll("p").forEach(p => {
        p.style.lineHeight = "1.6";
    });
  }

  private async loadAndDisplayHistory() {
    this.responseDivEl.empty();
    const history = this.plugin.settings.chatHistory;

    if (history && history.length > 0) {
      for (const entry of history) {
        await this.renderConversationEntry(entry);
      }
      // Scroll to bottom after loading all history
      const responseSection = this.responseDivEl.parentElement;
      if (responseSection) responseSection.scrollTop = responseSection.scrollHeight;
    } else {
      this.displayInitialMessage();
    }
  }
  private async syncWithActiveFile(activeFile: TFile | null) {
    const isMdFile = activeFile && activeFile.extension === "md";

    // Prompt area is no longer synced with the active file.

    // Sync Context Area
    if (!this.folderSelectEl.value) {
      // If "No folder selected"
      if (isMdFile) {
        const content = await this.app.vault.cachedRead(activeFile);
        this.currentContextContent = content;
        this.updateConcatenatedFilesList([activeFile.name]);
      } else {
        this.currentContextContent = "";
        this.updateConcatenatedFilesList([]);
      }
    }
    this.updateTokenWarning();
    this.updateLabelForPromptFileSelect(); // Ensure prompt label is correct
    this.updateLabelForFolderSelect();
  }

  private async handleActiveLeafChange() {
    if (!this.contentEl.isConnected) {
      // Check if the view is still part of the DOM
      return;
    }
    const activeFile = this.app.workspace.getActiveFile();
    await this.syncWithActiveFile(
      activeFile instanceof TFile ? activeFile : null
    );
  }

  private updateLabelForFolderSelect(): void {
    if (!this.folderLabelEl) return;
    if (this.folderSelectEl.value) {
      this.folderLabelEl.setText("Context Folder:");
    } else {
      this.folderLabelEl.setText(
        this.folderSelectEl.options[0]?.text || "Select Folder"
      );
    }
  }

  private updateLabelForPromptFileSelect(): void {
    if (!this.promptFileLabelEl) return;
    if (this.promptFileSelectEl.value) {
      this.promptFileLabelEl.setText("Select Prompt File:");
    } else {
      this.promptFileLabelEl.setText(
        this.promptFileSelectEl.options[0]?.text || "Select Prompt"
      );
    }
  }

  private populateFolderDropdown(): void {
    this.folderSelectEl.empty();
    this.folderSelectEl.createEl("option", {
      text: "Select context folder",
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

  private populatePromptFileDropdown(): void {
    this.promptFileSelectEl.empty();
    this.promptFileSelectEl.createEl("option", {
      text: "Prompt file location",
      value: "",
    });

    let filesToList: TFile[] = [];
    const promptFolderPath = this.plugin.settings.promptFilesFolderPath;

    if (promptFolderPath) {
      const folder = this.app.vault.getAbstractFileByPath(promptFolderPath);
      if (folder instanceof TFolder) {
        filesToList = this.app.vault.getMarkdownFiles().filter((file) => {
          return file.parent && file.parent.path === folder.path;
        });
      } else {
        new Notice(
          `Prompt folder "${promptFolderPath}" not found. Listing all markdown files.`,
          5000
        );
        filesToList = this.app.vault.getMarkdownFiles(); // Fallback
      }
    } else {
      // No specific prompt folder set, list all markdown files
      filesToList = this.app.vault.getMarkdownFiles();
    }

    filesToList.sort((a, b) => a.path.localeCompare(b.path)); // Sort files by path

    for (const file of filesToList) {
      this.promptFileSelectEl.createEl("option", {
        text: file.path, // Display full path for clarity
        value: file.path,
      });
    }
  }

  private async handlePromptFileSelectionChange(): Promise<void> {
    const selectedPath = this.promptFileSelectEl.value;
    if (selectedPath) {
      const file = this.app.vault.getAbstractFileByPath(selectedPath);
      if (file && file instanceof TFile && file.extension === "md") {
        const content = await this.app.vault.cachedRead(file);
        this.promptInputEl.value = content;
        this.promptInputEl.dispatchEvent(new Event("input")); // To update height and token count
      }
    } else {
      // If "Prompt file location" (empty value) is selected, clear the input
      this.promptInputEl.value = "";
      this.promptInputEl.dispatchEvent(new Event("input"));
    }
    this.updateTokenWarning();
    this.updateLabelForPromptFileSelect();
  }

  private async handleFolderSelectionChange(): Promise<void> {
    const selectedPath = this.folderSelectEl.value;
    if (selectedPath) {
      new Notice(`Loading context from folder: ${selectedPath}...`);
      await this.loadContextFromFolder(selectedPath);
    } else {
      this.currentContextContent = "";
      this.updateConcatenatedFilesList([]); // Clear the list
      // If "No folder selected", context should now come from the active file
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile instanceof TFile && activeFile.extension === "md") {
        const content = await this.app.vault.cachedRead(activeFile);
        this.currentContextContent = content;
        this.updateConcatenatedFilesList([activeFile.name]);
      }
    }
    this.updateTokenWarning();
    this.updateLabelForFolderSelect();
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
      if (!this.folderSelectEl.value) {
        // No folder selected
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile instanceof TFile && activeFile.extension === "md") {
          // This state should ideally be caught by fileNames.length > 0 if syncWithActiveFile worked
          this.concatenatedFilesListEl.setText(
            `Context: ${activeFile.name} (active)`
          );
        } else {
          this.concatenatedFilesListEl.setText(
            "No context: Select a folder or open an MD file."
          );
        }
      } else {
        // A folder is selected, but it's empty or failed to load
        this.concatenatedFilesListEl.setText(
          `No context files loaded from folder: ${this.folderSelectEl.value}`
        );
      }
      return;
    }
    this.concatenatedFilesListEl.createEl("strong", {
      text: "Context Source:",
    });
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

    new Setting(containerEl)
      .setName("Prompt Files Folder")
      .setDesc(
        "Select a folder to source your prompt files from. If 'None', all markdown files in the vault will be listed."
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("", "None (List all MD files)");
        const folders = this.app.vault
          .getAllLoadedFiles()
          .filter((f) => f instanceof TFolder) as TFolder[];
        folders.sort((a, b) => a.path.localeCompare(b.path));
        folders.forEach((folder) => {
          if (
            folder.path === ".obsidian" ||
            folder.path.startsWith(".obsidian/")
          ) {
            return; // Skip obsidian config folder
          }
          dropdown.addOption(folder.path, folder.path);
        });
        dropdown
          .setValue(this.plugin.settings.promptFilesFolderPath)
          .onChange(async (value) => {
            this.plugin.settings.promptFilesFolderPath = value;
            await this.plugin.saveSettings();
            new Notice(
              `Prompt files will now be sourced from: ${
                value || "All vault files"
              }`
            );
          });
      });
    new Setting(containerEl)
      .setName("Default Prompt File")
      .setDesc(
        "Select a Markdown file to automatically load as a prompt when the AI Assistant view opens. You can still edit it or choose another file in the view."
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("", "None (No default prompt)");
        const markdownFiles = this.app.vault.getMarkdownFiles();
        let filesForDefaultPromptDropdown: TFile[] = [];
        const selectedPromptFolder = this.plugin.settings.promptFilesFolderPath;

        if (selectedPromptFolder) {
          const folder =
            this.app.vault.getAbstractFileByPath(selectedPromptFolder);
          if (folder instanceof TFolder) {
            filesForDefaultPromptDropdown = markdownFiles.filter(
              (file) => file.parent && file.parent.path === selectedPromptFolder
            );
          } else {
            // Folder not found or invalid, list all as a fallback for this setting
            filesForDefaultPromptDropdown = markdownFiles;
          }
        } else {
          // No prompt folder selected, list all MD files
          filesForDefaultPromptDropdown = markdownFiles;
        }

        filesForDefaultPromptDropdown.sort((a, b) =>
          a.path.localeCompare(b.path)
        );
        filesForDefaultPromptDropdown.forEach((file) => {
          dropdown.addOption(file.path, file.path);
        });

        dropdown
          .setValue(this.plugin.settings.promptFilePath)
          .onChange(async (value) => {
            this.plugin.settings.promptFilePath = value;
            await this.plugin.saveSettings();
            // Optionally, notify the user or update the view if it's open
            if (value) new Notice(`Default prompt file set to: ${value}`);
            else new Notice("Default prompt file cleared.");
          });
      });
  }
}
