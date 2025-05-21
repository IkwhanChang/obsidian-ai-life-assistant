# Obsidian AI Life Assistant

**Obsidian AI Life Assistant is a plugin that integrates powerful AI capabilities directly into your Obsidian vault, helping you streamline your workflow, generate ideas, and enhance your productivity.**

## 🚀 Features

*   **AI-Powered Content Generation:** Generate text, summarize notes, or brainstorm ideas with AI assistance.
*   **Smart Suggestions:** Get relevant suggestions and completions as you type.
*   **Customizable Prompts:** Tailor AI interactions to your specific needs with custom prompts.
*   *(여기에 실제 구현된 다른 기능들을 추가해주세요. 예: "AI Chat Interface", "Image Generation via AI")*

## 📖 User Manual

### ⚙️ Installation

1.  **Method 1: Community Plugins (Recommended - Once officially listed)**
    *   *(This method will be available once the plugin is accepted into the official community plugin list.)*
    *   Open Obsidian's settings.
    *   Go to `Community plugins`.
    *   Ensure "Restricted mode" is **off**.
    *   Click `Browse` community plugins.
    *   Search for "AI Life Assistant".
    *   Click `Install`.
    *   Once installed, toggle the plugin **on** in the "Installed plugins" list.

2.  **Method 2: Using BRAT (For beta testing and easy updates from GitHub)**
    *   Install the BRAT plugin from the Obsidian community plugin browser.
    *   Open the BRAT settings (usually via the command palette: `BRAT: Add a beta plugin for testing`).
    *   Enter `IkwhanChang/obsidian-ai-life-assistant` as the repository.
    *   Enable the plugin in Obsidian's community plugin settings.

3.  **Method 3: Manual Installation**
    *   Download the latest release from the Releases page of this repository.
    *   From the downloaded ZIP file, extract the plugin folder (which includes `main.js`, `manifest.json`, and `styles.css`).
    *   Navigate to your Obsidian vault's plugin folder. This is usually located at `<YourVault>/.obsidian/plugins/`.
    *   Create a new folder named `obsidian-ai-life-assistant` (or your desired plugin ID) inside the plugins folder.
    *   Copy the extracted plugin files (`main.js`, `manifest.json`, `styles.css`) into this new folder.
    *   Restart Obsidian or reload the plugins.
    *   Go to `Settings` -> `Community plugins` -> `Installed plugins` and toggle the "AI Life Assistant" plugin **on**.

### 🛠️ How to Use

**Initial Setup:**
1.  After installing and enabling the plugin, open the plugin settings for "AI Life Assistant".
2.  Enter your **OpenAI API Key** in the designated field.
3.  (Optional but Recommended) Select a **Context Folder**. Notes within this folder can be used by the AI to provide more relevant and context-aware responses.

**Generating Content:**
1.  Open a note or create a new one in Obsidian.
2.  Activate the AI Life Assistant. This might be through:
    *   A command in the command palette (e.g., "AI Life Assistant: Ask AI").
    *   A button or icon added by the plugin.
    *   A hotkey you've configured.
3.  Enter your **prompt** or question for the AI.
4.  The AI will process your request, potentially using notes from your selected context folder, and provide a response directly in your note or a designated area.

*(You can add more specific examples or details about different commands/features here.)*

We welcome contributions to the Obsidian AI Life Assistant plugin! If you're interested in helping, here are a few ways you can contribute:

*   **🐛 Reporting Bugs:** If you encounter any bugs or unexpected behavior, please open an issue on our [GitHub Issues page](https://github.com/IkwhanChang/obsidian-ai-life-assistant/issues). Try to include steps to reproduce the bug, your Obsidian version, and any relevant error messages.
*   **💡 Suggesting Enhancements:** Have an idea for a new feature or an improvement to an existing one? We'd love to hear it! Please submit it as an issue with the "enhancement" label.
*   **🧑‍💻 Submitting Code:** If you'd like to contribute code, please fork the repository and submit a pull request with your changes. We appreciate well-documented code and tests where applicable.

Before submitting a pull request, please ensure your changes align with the project's coding style and goals.

## 📜 License

This plugin is licensed under the Apache License, Version 2.0.

Copyright (c) 2025 Matthew Chang, Jerry Kim

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.