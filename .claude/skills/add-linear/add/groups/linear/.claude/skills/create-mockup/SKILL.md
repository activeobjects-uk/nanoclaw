---
name: create-mockup
description: Create a rich interactive HTML/JS/CSS mockup from a description or requirements, publish it as a secret GitHub Gist, and share the live preview link in the Linear issue. Use when asked to design, mock up, wireframe, or visualise a UI.
---

# Create Interactive UI Mockup

You are producing a rich, interactive HTML/JS mockup and publishing it as a live shareable link on a Linear issue.

## Inputs

Invoked with an issue identifier and optional focus, e.g.:
- `/create-mockup ENG-123`
- `/create-mockup ENG-123 focus on the mobile layout`

If no identifier is given, use the issue from the most recent delivered message.

## Workflow

### 1. Load the issue

Use `mcp__linear__linear_get_issue` to fetch the full issue: title, description, comments.
Extract the UI requirements — what screen/component is being mocked up, platform (web/mobile), style preferences, any existing design system or colours mentioned.

### 2. Write the HTML mockup

Save to `/workspace/group/mockups/{IDENTIFIER}.html`.

**Quality standards — aim for Claude.ai artifact quality:**
- Single self-contained HTML file: all CSS and JS inline, zero external dependencies
- Use realistic viewport: `980px` for desktop, `390px` for mobile
- Include real interactivity: working tabs, dropdowns, modals, hover states, transitions
- Use realistic placeholder content — real-looking names, data, dates, not "Lorem ipsum"
- Clean modern design: system font stack, subtle shadows, rounded corners, consistent spacing
- Make it feel alive: add micro-interactions, smooth transitions (`transition: all 0.2s ease`)

**Template:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{Screen name}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f0f2f5;
      color: #1a1a2e;
      min-height: 100vh;
    }
    /* Component styles... */
  </style>
</head>
<body>
  <!-- Mockup content -->
  <script>
    // Interactivity
  </script>
</body>
</html>
```

If the issue involves a React-style component, use React and Babel via CDN for in-browser rendering — this works in htmlpreview:

```html
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script type="text/babel">
  // React component
</script>
```

### 3. Publish to GitHub Gist

Use Bash to call the GitHub API. Write the payload to a temp file first to safely handle any characters in the HTML:

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('/workspace/group/mockups/{IDENTIFIER}.html', 'utf8');
const payload = JSON.stringify({
  description: 'Mockup: {Issue title}',
  public: false,
  files: {
    '{IDENTIFIER}.html': { content }
  }
});
fs.writeFileSync('/tmp/gist-payload.json', payload);
"

curl -s -X POST https://api.github.com/gists \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.github+json" \
  -d @/tmp/gist-payload.json > /tmp/gist-response.json

node -e "
const r = JSON.parse(require('fs').readFileSync('/tmp/gist-response.json', 'utf8'));
if (!r.id) { console.error('Gist creation failed:', JSON.stringify(r)); process.exit(1); }
const previewUrl = 'https://gistpreview.github.io/?' + r.id;
console.log('GIST_ID=' + r.id);
console.log('PREVIEW_URL=' + previewUrl);
"
```

Save the `PREVIEW_URL` from the output — this is what you post to Linear.

### 4. Post comment with the live link

Use `mcp__linear__linear_add_comment`:

```
Mockup ready — [View live preview →]({PREVIEW_URL})

The link opens an interactive prototype in the browser. No login required.

**Design notes:**
- {Key decision or assumption}
- {Any open questions or alternatives considered}

Source file is also attached below if you'd like to edit it.
```

Then attach the HTML source file using `mcp__linear__linear_upload_file`:
```
filePath: mockups/{IDENTIFIER}.html
identifier: {IDENTIFIER}
title: Mockup source — {IDENTIFIER}.html
```

## Iterations

When the human replies with feedback, update the HTML and re-publish:

```bash
# Update the existing gist rather than creating a new one
node -e "
const fs = require('fs');
const content = fs.readFileSync('/workspace/group/mockups/{IDENTIFIER}.html', 'utf8');
const payload = JSON.stringify({ files: { '{IDENTIFIER}.html': { content } } });
fs.writeFileSync('/tmp/gist-update.json', payload);
"

curl -s -X PATCH https://api.github.com/gists/{GIST_ID} \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/gist-update.json > /dev/null
```

The preview URL stays the same after an update (it's based on the gist ID which doesn't change). Reply in the same thread: *"Updated — same link above."*

Store the gist ID in `/workspace/group/mockups/{IDENTIFIER}.gist` so you can update it in follow-up messages.

## If GITHUB_TOKEN is not set

If `$GITHUB_TOKEN` is empty, fall back to attaching the HTML file directly to the Linear issue using `mcp__linear__linear_upload_file` and note in the comment that it needs to be opened locally (or the token needs to be configured).

## Notes

- The preview URL uses the gist ID (`https://gistpreview.github.io/?{GIST_ID}`), so it remains stable across updates
- The gistpreview service renders the HTML as-is — external CDN scripts (React, Babel, Chart.js, etc.) work fine
- Keep all CSS and custom JS inline — no local file references
- If the mockup has multiple screens, create separate files (`{IDENTIFIER}-login.html`, `{IDENTIFIER}-dashboard.html`) and post all preview links in one comment
