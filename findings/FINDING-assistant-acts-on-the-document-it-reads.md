# Finding: the assistant acts on whichever document it happens to read

Observed on 2026-10-05 with ChatGPT Work against `lab.eleviq.solutions`, and
earlier on `eleviq.solutions`. Relevant to any site that publishes
instructions for AI assistants (`llms.txt`, an API description, an agent
page) and expects assistants to follow them.

## Symptom

The same assistant, given the same task on the same site, behaves differently
from run to run:

- **It ignores the agent instructions** and works from the pages written for
  humans. It then describes the offer from marketing copy, misses the
  agent-facing API, or draws wrong conclusions from a page built for browsers.
- **It uses the API but tells the site little.** Structured information the
  site asks for arrives incomplete, or only as free text. In three runs with
  an identical task, the assistant filled in 18%, 27% and 82% of the optional
  fields of the journey's intent declaration. In the two low runs the user's
  budget and deadline were only inside a free-text sentence.

Nothing fails. The task completes, so the gap is invisible unless the site
measures what it received.

## Root cause

An assistant does not look for a site's agent instructions as a matter of
course, and it does not read everything a site publishes. It reads what it is
led to, stops when it has enough to act, and then does what that one document
asks. Two consequences:

1. **Instructions that are published but not linked are not found.** The
   assistant lands on a human page and stays in human pages. When asked
   directly to find an agent instruction file, ChatGPT reported that it found
   `llms.txt` because "the homepage explicitly links" it, and that the
   conventional file names it guessed (`/AGENTS.md`, `/agents.md`) returned 404. The link did the work, not the convention.

2. **The assistant sends what the document it read asks for, and no more.**
   The lab's `llms.txt` named six of eleven optional fields in one dense
   sentence. The two runs that started from `llms.txt` sent two and three
   fields. The run that sent nine included four fields that `llms.txt` never
   mentioned, so it had read the journey's formal description as well. Which
   document the assistant read explains the swing better than anything in the
   task.

## Solution

1. **Link to the agent instructions from every page an assistant may land
   on, in more than one way.** `eleviq.solutions` uses four:

   ```html
   <link rel="describedby" href="/llms.txt" type="text/plain" title="AI agent instructions">
   <a href="/llms.txt">AI agent instructions</a>
   ```

   ```
   Link: </llms.txt>; rel="describedby"          (HTTP response header)
   # AI agents: instructions at https://example.com/llms.txt   (in robots.txt)
   ```

   The visible link matters most: it is the one a page fetcher and a browser
   both see. A short sentence addressed to assistants, saying what the file is
   for, is better than a bare link.

2. **Make the instruction document complete on its own.** Assume it is the
   only document the assistant reads. List every field, required and
   optional, with its allowed values. Do not leave part of the contract to an
   OpenAPI file one link further on.

3. **Give a full worked example.** Show a request with every field filled
   in. Use it to show where information belongs: a budget as a structured
   constraint, not as part of a sentence.

4. **Say what you want, not only what is required.** "Recommended" fields in
   a subordinate clause were mostly skipped. Ask plainly for every field the
   assistant knows the answer to.

5. **Measure what arrives.** A completeness score per journey and per agent
   made this visible. Without it the runs would have looked identical.

6. **Mark human-only pages as not authoritative where it matters.** If a page
   renders its real content with JavaScript, say in the instructions that the
   API is the source of truth and the page is not.

## Evidence

Intent declarations of the three ChatGPT runs, same task each time:

| Run | Entry point | Optional fields sent | Score |
|---|---|---|---|
| 06:27 PM | `llms.txt` URL typed in the prompt | request summary, principal, journey stage | 27% |
| 06:35 PM | `llms.txt` URL typed in the prompt | request summary, principal | 18% |
| 06:57 PM | site named, front page read first | the above plus constraints, decision criteria, authority, expected deliverable, discovery source, agent claim | 82% |

In the first test of the day, before the site let the assistant through to
`llms.txt`, ChatGPT answered the user's question from the marketing pages of
`eleviq.solutions` and proposed a scope of its own.

The explicit links on `eleviq.solutions` were added after an earlier case in
which an assistant took its instructions from the human pages instead of
`llms.txt`. That case is recalled by the site owner and was not re-tested for
this note.

## What is not established

- **That the fix stabilises the score.** `llms.txt` on the lab now lists all
  fields with a full example. Repeated runs with the same prompt after that
  change are still to be done.
- **Which documents the assistant read in each run.** Inferred from the
  fields it sent; there is no log of its reads.
- **How much is plain run-to-run variation.** Three runs, two different
  prompts.
- **Which of the four link forms assistants use.** They were added together.
- **Other assistants.** Only ChatGPT Work was tested.

## Related

- [An AI assistant cannot get past the front page](FINDING-assistant-blocked-by-robots-directives.md):
  a link to the instructions only helps if the assistant is allowed to follow
  it.
