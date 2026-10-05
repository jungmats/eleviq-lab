# Finding: the assistant pauses for approval before a committing step

Observed on 2026-10-05 with ChatGPT Work against `lab.eleviq.solutions`.
Relevant to any agent-facing flow that ends in a commitment: a quote request,
a booking, an order, a sign-up.

## Symptom

The assistant runs a multi-step flow on its own up to the last step, then
stops and asks its user before doing it. On the site's side the journey sits
unfinished for minutes, hours, or for good.

In the observed run the assistant completed discovery, qualification and
email verification without asking, then reported:

> Automatic approval review blocked the final demo quote request because it
> classified it as an external lead submission beyond your investigation
> request. Nothing was booked or purchased. Would you like me to submit that
> demo quote request?

The user said yes about five minutes later and the journey completed.

## Root cause

This is the assistant working as intended, not a fault on the site. The
assistant compares each action with what its user actually asked for. The
user had asked to *find out* whether the provider fits; submitting a lead goes
beyond that, so the assistant asked first.

Two things decide whether it pauses:

- **How far the user's request reaches.** With "find out whether X could
  help", it paused. With "read the instructions and follow them" (two earlier
  runs, same site, same task), it submitted the quote request without asking.
- **What the step does.** Reading a catalogue and answering qualification
  questions passed without a pause. Sending the user's details to a third
  party as a lead did not.

## What it means for a solution

1. **Expect a human pause before any committing step.** Design the flow so
   that everything before it can run unattended and the commitment is one
   clearly separated last step.

2. **Set the timeout before that step for a human, not for an agent.** The
   lab journey expires after 30 minutes idle; the pause here was five. A user
   who is asked in the evening and answers the next morning would find the
   journey expired. Hours or days are the right order, or let an expired
   journey be resumed.

3. **Read drop-off at the last step differently.** A journey that stops just
   before the commitment is often a user who said no or never answered, not an
   agent that failed. In the funnel it should be told apart from technical
   abandonment. An explicit cancel with a reason is the cleanest signal;
   instructions should ask the assistant to send one when the user declines.

4. **Tell the assistant what the last step commits to.** State plainly in the
   step's description what happens, whether it is binding and what data is
   sent. The assistant relays this to the user when it asks, and a clear
   statement makes a yes more likely than a vague one. In the observed run
   the assistant could tell its user that nothing would be booked or charged
   because the site said so.

5. **Do not try to prevent the pause.** Wording that pushes the assistant to
   commit without asking works against the user's interest and against the
   assistant's safeguards.

## Evidence

Journey events of the observed run (times in UTC+2):

| Time | Step | Result |
|---|---|---|
| 06:57:12 PM | start | accepted |
| 06:57:28 PM | discover | accepted |
| 06:58:19 PM | qualify | accepted, after one refusal for missing fields |
| 06:59:25 PM | verification code | issued, after one refusal |
| 06:59:42 PM | verify | accepted |
| — | assistant asks the user | 5 min 13 s with no calls |
| 07:04:55 PM | transact (request-quote) | accepted, journey achieved |

## What is not established

- **How often it pauses.** One paused run and two that did not, with
  different prompts. No repeated runs with the same prompt.
- **Other assistants.** Only ChatGPT Work was tested.
- **How the assistant handles an expired journey** when the user approves too
  late. Not tested.
- **Whether the step's wording changes the outcome** (point 4). It is a
  reasoned recommendation, not a tested one.
