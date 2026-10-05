# Finding: an AI assistant cannot get past the front page

Observed on 2026-10-05 with ChatGPT Work against `lab.eleviq.solutions`.
Reusable as a check for any client site that wants AI assistants to read its
content or use its agent-facing API.

## Symptom

A user asks their assistant to evaluate a company and names only the site
("Start at example.com"). The assistant:

- answers from general or marketing content instead of the site's agent
  instructions, and does not use the site's API;
- reports that it was blocked, in wording such as *"browser security policy
  blocked its links"*, *"web retrieval reports not accessible"* or
  `net::ERR_BLOCKED_BY_CLIENT`;
- asks to open a cloud browser, and fails there too;
- offers to continue if the user pastes the instructions into the chat.

The same assistant completes the task without trouble when the user types the
URL of the instruction file (`/llms.txt`) into the prompt. That contrast is the
tell: the content and the API are fine, the path to them is closed.

Nothing shows up in the site's own logs, because the assistant gives up before
it makes the request.

## Root cause

Directives meant to keep search engines out also keep user-triggered
assistants out. Two were in place:

1. **`robots.txt` disallowed everything for every user agent.**

   ```
   User-agent: *
   Disallow: /
   ```

2. **Every HTML page carried `noindex, nofollow`.**

   ```html
   <meta name="robots" content="noindex, nofollow">
   ```

   `nofollow` asks a visitor not to follow the links on the page. The front
   page was the only way to the instruction file, so the assistant could open
   the page it was given and go no further. Plain-text files such as
   `llms.txt` cannot carry this tag, which is why the typed URL worked.

Both were set deliberately, to keep an unlisted demo site out of search
results. The intent was "do not index"; the effect was "do not enter".

### Why the cloud browser appears

ChatGPT has two ways to reach a site: a background page fetcher, and a visible
cloud browser. The fetcher goes first. When it cannot read the page, the
assistant asks for the cloud browser as a second attempt. A request for the
cloud browser on a simple reading task is therefore a symptom of the fetcher
failing, not a separate problem.

## Solution

1. **Allow user-triggered assistants in `robots.txt`**, and keep crawlers out
   if the site should stay unlisted:

   ```
   User-agent: ChatGPT-User
   User-agent: Claude-User
   User-agent: Perplexity-User
   Allow: /

   User-agent: *
   Disallow: /
   ```

2. **Remove `nofollow` (and `noindex`) from every page on the path** from the
   entry page to the agent instructions. With the `robots.txt` above, crawlers
   that obey it never fetch the page, so the site stays unlisted without the
   tag.

3. **Retest in a fresh chat** with a prompt that names only the site. Allow
   ten minutes or more after deploying; the assistant kept failing for a short
   while after the first change.

## How to check a client site

```
curl -s https://example.com/robots.txt
curl -s https://example.com/ | grep -i 'name="robots"'
curl -sI https://example.com/ | grep -i x-robots-tag
```

Look for a blanket `Disallow: /`, a `nofollow` or `noindex` meta tag, and the
same directives sent as an `X-Robots-Tag` response header. Check the entry
page and every page between it and the agent instructions. Staging sites,
relaunches and "coming soon" pages often carry these and keep them by accident
after going live.

## Evidence

All runs used ChatGPT Work and the same task: find out whether ElevIQ can help
a B2B shop, budget 5000 EUR, deadline end of November.

| # | Site state | Prompt names | Result |
|---|---|---|---|
| 1 | `Disallow: /` for all; `nofollow` on all pages | the site | Blocked at the link to `llms.txt` |
| 2 | Assistants allowed in `robots.txt`; `nofollow` on all pages | `llms.txt` and the API URL | Journey completed |
| 3 | as 2 | `llms.txt` only | Journey completed |
| 4 | as 2 | the site | Blocked; cloud browser requested |
| 5 | as 2, cloud browser refused by the user | the site | "Web retrieval couldn't read the site" |
| 6 | as 2, `nofollow` and `noindex` removed from the front page | the site | Journey completed; final step after the user approved it |

Completed journeys were confirmed in the journey database, each as verified
agent "ChatGPT" (requests signed with Web Bot Auth, key from the ChatGPT
registry).

## What is not established

- **Which of the two changes is needed.** They were made one after the other
  and the site-only prompt first passed after the second. No run tested the
  meta tag change with the old `robots.txt`. Apply both.
- **Whether `nofollow` or `noindex` was the blocking part.** Both were removed
  together.
- **Other assistants.** Only ChatGPT Work was tested. The `robots.txt` entries
  for Claude and Perplexity are untested.
- **OpenAI's exact rules.** The cause is inferred from which runs passed and
  failed; OpenAI's tool behaviour is not visible from outside. OpenAI
  separately restricts agents from opening URLs that neither the user supplied
  nor its index knows
  ([link safety](https://openai.com/index/ai-agent-link-safety/)); that rule
  may contribute on unlisted sites.

## Related observations from the same runs

- ChatGPT Work made the journey's `POST` calls itself, signed, with URLs
  containing a fresh journey id. No connector was needed.
- The assistant never submitted the user's email when it could not complete
  the journey.
- In run 6 the assistant stopped before the final step: its own approval
  review classified the quote request as an external lead submission beyond
  what the user had asked for, and it asked the user first. In runs 2 and 3,
  where the prompt said to follow the instructions, it submitted the request
  without asking.
- In run 6 two calls were refused for missing or invalid fields (HTTP 422, at
  qualify and at the verification code). The assistant read each refusal and
  succeeded on the second attempt.
- How much of the intent declaration it filled in varied widely between runs
  (18%, 27%, 82%), with the same task and the same instructions.
