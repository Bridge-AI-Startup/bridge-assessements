/**
 * Prompts for vision-based region detection and region-specific OCR.
 * Used when TRANSCRIPT_REGION_DETECTION=true.
 */

/**
 * Cheap layout detection prompt for GPT-4o-mini.
 * Returns bounding boxes of detected UI regions.
 */
export const PROMPT_DETECT_REGIONS = `You are a precise UI layout detector. Analyze this screenshot and identify the MAIN content panels only.

CRITICAL RULES:
1. Only return MAJOR panels — ignore status bars, title bars, tab bars, toolbars, and small UI chrome. Do NOT use "other" unless there is a large unclassifiable panel.
2. Bounding boxes must be TIGHT — do not let one region overlap another. Each pixel should belong to at most one region.
3. For VS Code / IDE layouts: the terminal panel is ONLY the terminal output area (dark background with command text). Do NOT include the status bar at the bottom.
4. Claude Code, Cursor chat, Copilot chat, ChatGPT sidebars, or any AI assistant panel visible in an IDE should be "ai_chat" — even if embedded inside the editor area. Look for conversation-style UI with Human/Assistant or User/Agent messages.
5. If the screen shows a web browser, return ONE "browser" region covering the full browser viewport (below the address bar). Do not split browser content into sub-regions.
6. Prefer fewer, larger regions over many small ones. A typical IDE has 3-4 regions max.

Return a JSON array. Each region:
- regionType: one of "ai_chat", "terminal", "editor", "file_tree", "browser"
- x: left edge as percentage of image width (0-100)
- y: top edge as percentage of image height (0-100)
- width: region width as percentage (0-100)
- height: region height as percentage (0-100)
- confidence: 0.0 to 1.0

Region types:
- "ai_chat": AI assistant panels, chat interfaces, agent output (Claude Code, Cursor, Copilot, ChatGPT, any messaging/conversation UI)
- "terminal": terminal/shell output area only (not status bars)
- "editor": code/text editor main area
- "file_tree": file explorer sidebar
- "browser": web browser content area (full viewport)

TEXT HINT USAGE: The user message may include OCR text samples from horizontal strips with [y≈XX%] labels showing where they came from. Use these to disambiguate visually similar panels:
- Text with "Human:", "Assistant:", "Claude", "Agent", chat-style turn-taking → "ai_chat"
- Text with "$", ">>>", shell prompts, "npm", "git", command output, file paths with "%" → "terminal"
- Text with "import", "function", "const", "class", code syntax, line numbers → "editor"
- Text with folder/file names in a tree structure, arrows/chevrons → "file_tree"
- Text with URLs, "http", web page content, tabs/logos on top → "browser"

LOCATION HINTS: 
- AI chat is usually on the right side of the screen, going from top to bottom.
- File tree is usually on the left side of the screen, going from top to bottom.
- Terminal is usually at the bottom of the screen, going from file tree to ai chat. If one of those don't exist, it reaches the corresponding side of screen
- Editor is usually in the middle of the screen.
- Browser is usually the full screen, except when it's a small window. Browser usually shows up alone.

Output ONLY the JSON array, no other text.

Example for a typical VS Code layout:
[
  {"regionType":"file_tree","x":0,"y":3,"width":14,"height":93,"confidence":0.95},
  {"regionType":"editor","x":14,"y":3,"width":56,"height":55,"confidence":0.95},
  {"regionType":"terminal","x":14,"y":58,"width":56,"height":38,"confidence":0.9},
  {"regionType":"ai_chat","x":70,"y":3,"width":30,"height":93,"confidence":0.92}
]

Example for a full-screen browser:
[
  {"regionType":"browser","x":0,"y":5,"width":100,"height":95,"confidence":0.95}
]`;

/**
 * Region-specific OCR prompt for AI chat panels.
 * Maximum verbosity — every word matters.
 */
export const PROMPT_REGION_AI_CHAT = `You are transcribing an AI chat/agent panel from a coding session screenshot. This is a CROPPED image showing ONLY the chat region.

Transcribe EVERY message VERBATIM, character-for-character. Include:
- Sender labels (Human/Assistant/User/Agent/System/Claude/GPT etc.)
- Complete message text — do NOT truncate or summarize
- Code blocks within messages (with language tags if visible)
- Error messages or warnings shown in the chat
- Timestamps if visible
- Tool calls, function outputs, or any structured content

Output format: One JSONL line with the full transcript.
{"ts":"ISO","ts_end":"ISO","screen":0,"region":"ai_chat","app":"AppName","text_content":"full verbatim chat text"}

This is the HIGHEST PRIORITY content. Spend all available tokens here. Never summarize.`;

/**
 * Region-specific OCR prompt for terminal.
 */
export const PROMPT_REGION_TERMINAL = `You are transcribing a terminal/command-line panel from a coding session screenshot. This is a CROPPED image showing ONLY the terminal region.

Transcribe ALL text verbatim:
- Command prompts (e.g., "$ ", "user@host:", "> ")
- Commands typed by the user
- All command output, error messages, stack traces, test results
- Preserve exact formatting and indentation

Output format: One JSONL line.
{"ts":"ISO","ts_end":"ISO","screen":0,"region":"terminal","app":"Terminal","text_content":"full verbatim terminal text"}`;

/**
 * Region-specific OCR prompt for code editor.
 * Less detail than chat/terminal — code is in the git diff.
 */
export const PROMPT_REGION_CODE = `You are transcribing a code editor panel from a coding session screenshot. This is a CROPPED image showing ONLY the editor region.

Extract:
- The filename from the tab or title bar
- The programming language
- If the cursor is visible or text is highlighted/selected (active editing): transcribe the visible code verbatim
- If code is static (just being viewed): provide the filename, language, and a 1-2 sentence summary of what the visible code does. Include approximate line numbers if visible.

Output format: One JSONL line.
{"ts":"ISO","ts_end":"ISO","screen":0,"region":"editor","app":"VS Code","text_content":"File: path/to/file.ts (TypeScript)\\n[code or summary]"}`;

/**
 * Region-specific OCR prompt for file tree.
 */
export const PROMPT_REGION_FILE_TREE = `You are transcribing a file explorer/tree panel from a coding session screenshot. This is a CROPPED image showing ONLY the file tree region.

Extract:
- Which folders are expanded
- Which file is currently selected/highlighted
- Any visible project structure context

Keep it brief — just the key files and folders visible.

Output format: One JSONL line.
{"ts":"ISO","ts_end":"ISO","screen":0,"region":"file_tree","app":"VS Code","text_content":"Expanded: src/routes/ — selected: api.ts"}`;

/**
 * Map from region type to its specific prompt.
 */
export const REGION_PROMPTS: Record<string, string> = {
  ai_chat: PROMPT_REGION_AI_CHAT,
  terminal: PROMPT_REGION_TERMINAL,
  editor: PROMPT_REGION_CODE,
  file_tree: PROMPT_REGION_FILE_TREE,
  browser: PROMPT_REGION_AI_CHAT, // Browser AI tools get full verbatim treatment
  other: PROMPT_REGION_TERMINAL, // Default to verbatim for unknown regions
};
