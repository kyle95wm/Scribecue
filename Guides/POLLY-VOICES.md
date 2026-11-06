# Amazon Polly voices

Amazon Polly's voices make real recordings, so lengths are exact and you can export a
description track. Each reading sends the block's text to Amazon.

You need your own AWS account. This guide sets up a key that can only use Polly, then
stops the voices if a month's cost passes a limit you choose.

AWS's console changes often. If a screen doesn't match, look for the nearest equivalent.

## Contents

- [Which voices](#which-voices)
- [Setting up the key](#setting-up-the-key)
- [Stopping at a spending limit](#stopping-at-a-spending-limit)
- [What adds up](#what-adds-up)
- [Privacy](#privacy)
- [Keys for QC reviews](#keys-for-qc-reviews)
- [If something goes wrong](#if-something-goes-wrong)

## Which voices

Scribecue offers two kinds. The voice list shows which is which.

| Kind | Sounds | Costs more? |
| --- | --- | --- |
| **Neural** | Natural | About four times as much as Standard |
| **Standard** | More robotic | The cheapest |

Polly also has Long-Form and Generative voices. Scribecue doesn't offer them: Long-Form
costs too much for lines that are read again, and Generative can't reliably change
speed on short blocks.

See [Amazon's prices](https://aws.amazon.com/polly/pricing/) for current costs and free
allowances. Some allowances only last for your first year.

## Setting up the key

Use a key that can only reach Polly, never your AWS account's main login. An AWS key
can't be limited to one website, as a Google key can, so this is what protects you if it
gets out.

1. In the [IAM console](https://console.aws.amazon.com/iam/), open **Policies** and click
   **Create policy**.
2. Choose **JSON**, replace what's there with this, and click **Next**:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["polly:SynthesizeSpeech", "polly:DescribeVoices"],
         "Resource": "*"
       }
     ]
   }
   ```

3. Name it `scribecue-polly`, and click **Create policy**.
4. Open **Users**, click **Create user**, and name it `scribecue`. Leave console access
   off.
5. On the permissions step, choose **Attach policies directly**, tick `scribecue-polly`,
   and finish.
6. Open the user, then **Security credentials**, and click **Create access key**.
7. Choose **Application running outside AWS**.
8. Copy both the access key and the secret key. AWS only shows the secret once.
9. In Scribecue, open **Settings**, choose **Text to speech**, and find **Amazon Polly
   voices**.
10. Paste both keys, and choose the region nearest to you.

The voices in your languages appear in the voice list, under **Amazon Polly**. **Forget**
removes the key and its voices.

## Stopping at a spending limit

A budget can block the `scribecue` user once the month's cost passes your limit. Your
other voices keep working, and Polly starts working again next month.

### 1. Create the stop policy

1. In **Policies**, click **Create policy** and choose **JSON**.
2. Paste this:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Deny", "Action": "polly:*", "Resource": "*" }
     ]
   }
   ```

3. Name it `scribecue-polly-stop`.

### 2. Let budgets apply it

1. In **Policies**, create one more policy, named `scribecue-budget-action`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["iam:AttachUserPolicy", "iam:DetachUserPolicy"],
         "Resource": "*"
       }
     ]
   }
   ```

2. Open **Roles**, click **Create role**, and choose **Custom trust policy**.
3. Paste this:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": { "Service": "budgets.amazonaws.com" },
         "Action": "sts:AssumeRole"
       }
     ]
   }
   ```

4. Attach `scribecue-budget-action`, and name the role `scribecue-budget`.

### 3. Create the budget

1. Open [AWS Budgets](https://console.aws.amazon.com/billing/home#/budgets), and click
   **Create budget**.
2. Choose **Customize**, then **Cost budget**.
3. Set a **Monthly** budget with a fixed amount, such as `1`.
4. Add an alert at 100% of the budget, on **Actual** cost, with your email address.
5. Under **Attach actions**, click **Add Action**:
   - **IAM role:** `scribecue-budget`.
   - **Action:** apply an IAM policy, `scribecue-polly-stop`, to the user `scribecue`.
   - **Automatically run this action:** **Yes**.
6. Finish, and click **Create budget**.

### What happens from then on

- **Under your limit:** nothing.
- **Over your limit:** you get an email, and Polly refuses readings. Scribecue shows why
  when it tries a Polly voice.
- **Next month:** AWS removes the block by itself.
- **Costs are reported late:** several hours behind, so it stops a little past the limit.
- **Starting again sooner:** raise the budget, then detach `scribecue-polly-stop` from
  the user.

## What adds up

Each line is only sent to Amazon, and counted, once, unless you change its text, speed or
voice.

- **Editing a line:** it's read again when you close it after a change.
- **Speeds:** each speed is a separate reading. **Fit speeds to timings** tries two to
  four per block.
- **Changing the voice or base speed:** every block is read again. So are jobs such as
  **Make all readings**. Scribecue warns you first.
- **Clearing stored readings:** lines are read again. So they are in another browser.

A 45-minute episode is about 12,000 to 25,000 characters, and a film 30,000 to 70,000.

## Privacy

- Each reading sends the block's text, as it's read aloud, to Amazon. Nothing else from
  your project goes with it.
- Readings are kept in your browser, so lines aren't sent twice. **Settings**, under
  **Storage**, shows them and can clear them.
- The key stays in your browser, and is only used with Amazon. **Forget** removes it.
  **Remove all data** does too.
- Scribecue doesn't contact Amazon when it opens. The voice list is only fetched when you
  change the key or open the text to speech settings.

## Keys for QC reviews

A [QC package](QC.md#make-a-portable-qc-package) keeps Polly readings, so a reviewer needs
no key to listen. To hear corrections, they need a key: their own, or a separate one in
the package.

Anyone with the package can read a key in it, and an AWS key works from anywhere. So
make a separate one with an end date, and keep your spending limit on.

1. In **Policies**, create a policy named `scribecue-polly-review`. Put your own end date
   and region in it:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "polly:SynthesizeSpeech",
         "Resource": "*",
         "Condition": {
           "DateLessThan": { "aws:CurrentTime": "2027-01-31T00:00:00Z" },
           "StringEquals": { "aws:RequestedRegion": "ca-central-1" }
         }
       }
     ]
   }
   ```

2. Create a user named `scribecue-review`, with no console access, and attach the policy.
3. Create an access key for it, as in [Setting up the key](#setting-up-the-key).
4. Open your budget, edit its action, and add `scribecue-review` to the users. Without
   this, the spending limit doesn't cover the key.
5. In **Export → QC package**, turn on **Allow reviewers to edit blocks**.
6. Choose **Include a separate Amazon Polly review key**.
7. Paste both keys, and choose the same region as the policy.

When the review is done, delete the access key. For the next review, make a new key and
change the policy's end date.

- **Reviewers' own keys go first.** If one fails, Scribecue asks before using the package's.
- **Costs:** the review key's readings go on your bill.
- **If a key gets out:** delete it. Only the spending limit caps what it can cost.
- **Over the limit:** the block stops your own voices as well, until next month.
- **Return packages** leave the key out.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "Amazon didn't accept the access key" | Check you copied all of it. |
| "Amazon didn't accept the secret key" | Paste the secret again. If it's lost, create a new access key. |
| "Check this computer's clock" | Set your computer's clock to update automatically. |
| "Amazon refused: …" | The user may lack `scribecue-polly`, or your budget may have stopped it. Check your budget emails. |
| "That voice isn't offered in this AWS region" | Choose another voice or region. |
| "Too many readings" | Wait a moment and try again. |
| "Couldn't reach Amazon" | Check your internet connection. |
| "Needs Scribecue at an https or localhost address" | Open Scribecue at the web version's address, or at `localhost`. |
| No Polly voices in the list | Reopen the text to speech settings while you're online. |
