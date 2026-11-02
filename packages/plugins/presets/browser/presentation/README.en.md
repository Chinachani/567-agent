## Connect your current browser without startup flags

Go to **Settings → General → Connect your current browser**, install Microsoft’s official Playwright extension, and enable the connection. Pinned connection components download on first startup. This path does not require the agent-browser CLI or Chrome for Testing.

On first use, approve the connection and select the intended tab in the extension. The agent checks its title and URL before working. Later focus changes do not switch an ongoing task to another tab. Optional approval tokens and browser profile directory names belong in settings; never paste a token into chat.

Tasks involving signed-in pages, forms, or website interaction checks should invoke browser capabilities proactively. Questions about browser features or public fact lookup do not request access to unrelated pages.

Existing local debugging connections and explicitly requested separate task browsers remain available. Extension errors are reported without silently switching browsers. Disabling retains pairing settings; an in-flight turn follows the existing lifecycle.

## Best suited for

Browser Use is for work that must happen inside a real page: signing in to an admin console, paging through data, filling forms, changing filters, or collecting results across several pages. Prefer web search when a public-information summary is enough; use browser operation when the agent must enter a page and complete the workflow.

## How to use it

State the goal, URL, and boundaries directly in the conversation. For sign-in, captchas, or two-factor authentication, the agent hands you the visible browser window and continues after you finish. For publishing, payments, deletion, or final submission, explicitly ask it to stop before confirmation.

The default is to connect to your existing browser and verify the target tab first. You may need to enable local remote debugging and approve the connection. Connection failures are explained without silently opening a different browser. A separate task browser is created only when explicitly requested.

On first use, the agent checks and installs the pinned `agent-browser` runtime in 567 Agent's private npm directory. Chrome for Testing is installed only for a requested separate task browser when no reusable Chrome is available. 567 Agent manages this runtime separately and does not overwrite a global installation; use the plugin panel to retry and diagnose an automated setup failure.

## Sessions and privacy

Each task has its own control session bound to a verified tab. Connecting to your existing browser shares its login state; a control session is not an isolated profile. Your browser and tabs stay open after the task. Separate task browsers can use profiles and account keys for independent state.

Ordinary forms use page elements. Canvas areas can use viewport screenshots and browser-page mouse coordinates, followed by verification. This does not control the whole desktop or OS dialogs. Never put email addresses, passwords, cookies, or tokens in profile names, prompts, or logs.
