# Google Cloud voices: the complete guide

Scribecue can read your blocks with Google Cloud's **Standard** text to speech voices,
using your own Google Cloud key. Like Piper voices, they return real recordings, so
lengths are exact straight away and you can export a description track. Unlike Piper,
each reading sends the block's text to Google, and they need the internet.

Google Cloud needs a billing account, even for the free allowance. This guide covers
setting up the key, and then setting up Google Cloud so that **you're never billed**: if a
month's readings ever go past the free allowance, billing is turned off and the voices
simply stop until you turn it back on.

Google's console changes often. If a screen doesn't match what's described here, look for
the nearest equivalent, or Google's own guide,
[Disable billing usage with notifications](https://cloud.google.com/billing/docs/how-to/disable-billing-with-notifications).

## Contents

- [Setting up the key](#setting-up-the-key)
- [Never being billed](#never-being-billed)
  - [Why a budget alone isn't enough](#why-a-budget-alone-isnt-enough)
  - [1. Turn on the APIs](#1-turn-on-the-apis)
  - [2. Create a Pub/Sub topic](#2-create-a-pubsub-topic)
  - [3. Create the budget](#3-create-the-budget)
  - [4. Create the function](#4-create-the-function)
  - [5. Add the code](#5-add-the-code)
  - [6. Let the function turn billing off](#6-let-the-function-turn-billing-off)
  - [7. Test it](#7-test-it)
  - [8. Turn billing back on](#8-turn-billing-back-on)
- [What happens from then on](#what-happens-from-then-on)
- [Privacy](#privacy)
- [If something goes wrong](#if-something-goes-wrong)

## Setting up the key

Use a Google Cloud project that's only for Scribecue. Turning billing off, as below, stops
everything in the project, so nothing else should live there.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project, or
   choose your Scribecue one at the top.
2. Turn on the [Cloud Text-to-Speech API](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com)
   for it. Google asks you to set up a billing account if the project doesn't have one.
3. Go to **APIs & Services**, then **Credentials**, and click **Create credentials**,
   **API key**.
4. Restrict the key, so it's no use to anyone else who gets hold of it:
   - **Name:** anything, such as `Scribecue`.
   - **API restrictions:** only the **Cloud Text-to-Speech API**.
   - **Application restrictions:** **Websites**, and add each address you open Scribecue
     at:
     - `https://scribecue.kyleadvoice.ca/*` for the web version
     - `http://localhost:8484/*` for Docker, or your own port if you've changed it

     Scribecue sends Google only its address, never anything else about the page, so
     this works without giving anything away.
5. Copy the key.
6. In Scribecue, open **Settings**, choose **Text to speech**, and paste the key under
   **Google Cloud voices**.

The Standard voices in your languages appear in the voice list, under **Google Cloud**.
The first is chosen for you if you weren't using a Piper voice. **Forget** removes the key
and its voices.

## Never being billed

Standard voices have a free allowance of characters each month, which is plenty for most
work, but jobs such as **Fit speeds to timings** read each block more than once. See
[Google's prices](https://cloud.google.com/text-to-speech/pricing) for the current
allowance.

### Why a budget alone isn't enough

- **A budget only warns.** Google Cloud budgets send emails as spending passes amounts you
  set, but they don't stop anything.
- **Spend caps don't cover Text-to-Speech.** **Budgets & caps** offers **Spend cap
  enforcement**, which does pause usage, but only for a few services, such as Cloud Run
  and Gemini. Text-to-Speech isn't one of them, at least as of October 2026. If it's
  offered when you set this up, a spend cap on the Cloud Text-to-Speech API does the whole
  job, and you can skip the rest of this section.

So the budget is connected to a small function, which turns billing off for the project
as soon as the month's cost passes $1. With billing off, Google stops answering, and
Scribecue's Google voices stop. Nothing is charged past that point.

### 1. Turn on the APIs

With your Scribecue project chosen at the top, go to **APIs & Services**, **Library**,
and turn on each of these. **Manage** instead of **Enable** means it's already on.

- **Cloud Billing API**
- **Cloud Pub/Sub API**
- **Cloud Run Admin API**
- **Cloud Build API**
- **Eventarc API**

### 2. Create a Pub/Sub topic

The budget sends its figures here.

1. Open **Pub/Sub**, then **Topics**, and click **Create topic**.
2. **Topic ID:** `stop-billing`. Leave **Add a default subscription** ticked.
3. Click **Create**.

### 3. Create the budget

1. Open **Billing**, then **Budgets & caps** (it may be called **Budgets & alerts**), and
   click **Create budget**.
2. **Define:** choose **Alerts only**, and name it `Scribecue stop`.
3. **Scope:**
   - **Time range:** **Monthly**.
   - **Projects:** your Scribecue project.
   - **Services:** **All services**. That way it also notices anything else in the
     project that starts costing money.
   - Leave the **Savings** boxes ticked.
4. **Amount:** **Specified amount**, `1`. The free allowance isn't charged, so any cost at
   all means you've gone past it.
5. **Actions:**
   - **Thresholds:** 50%, 90% and 100%, each triggered on **Actual** cost. Remove any
     **Forecasted** ones.
   - Keep **Email alerts to billing admins and users** ticked.
   - Tick **Connect a Pub/Sub topic to this budget**, and choose
     `projects/YOUR-PROJECT-ID/topics/stop-billing`.
6. Click **Finish**.

The thresholds only decide when you get emails. The budget sends its figures to the topic
several times a day either way.

### 4. Create the function

1. Open **Cloud Run**, and under **Write a function**, click **Python**.
2. Fill in:
   - **Service name:** `stop-billing`.
   - **Region:** one near you, such as `us-central1`.
   - **Runtime:** the newest **Python 3** that isn't marked as a preview. It's usually
     already chosen.
3. Under **Trigger**, click **Add trigger**, **Pub/Sub trigger**, **Eventarc**. Not
   **Direct**: it sends the message in a different shape, which the code below doesn't
   read.
   - **Select a Cloud Pub/Sub topic:** `projects/YOUR-PROJECT-ID/topics/stop-billing`. If
     it says a new topic will be created, the topic isn't chosen yet.
   - **Region:** the same as the function.
   - **Service account:** leave the default compute service account. Note its address,
     which ends in `-compute@developer.gserviceaccount.com`. You'll need it in step 6.
   - **Enable retry on failure:** leave it off. The budget sends its figures again
     several times a day anyway.
   - Click **Grant** on any role it offers, then **Save trigger**.
4. **Authentication:** **Require authentication**, with **Identity and Access Management
   (IAM)** ticked.
5. **Billing:** **Request-based**.
6. **Service scaling:** **Auto scaling**, minimum `0`, maximum `1`. One copy is all it
   needs, and the maximum guarantees it can never scale up.
7. **Ingress:** leave it on **All**. With authentication required, only Google's trigger
   can call it.
8. Click **Create**.

### 5. Add the code

The function opens on its **Source** tab, with an editor.

1. Replace everything in `requirements.txt` with:

   ```
   functions-framework
   google-cloud-billing
   ```

2. Replace everything in `main.py` with the code below, putting your project ID in place
   of `YOUR-PROJECT-ID`. The ID is the one in the topic's name, which may differ from the
   project's display name.

   ```python
   import base64
   import json

   import functions_framework
   from google.cloud import billing_v1

   PROJECT = "projects/YOUR-PROJECT-ID"


   @functions_framework.cloud_event
   def stop_billing(event):
       data = json.loads(base64.b64decode(event.data["message"]["data"]))
       if data["costAmount"] <= data["budgetAmount"]:
           print(f"Under budget: {data['costAmount']} of {data['budgetAmount']}")
           return
       client = billing_v1.CloudBillingClient()
       info = client.get_project_billing_info(name=PROJECT)
       if info.billing_enabled:
           client.update_project_billing_info(
               name=PROJECT,
               project_billing_info=billing_v1.ProjectBillingInfo(billing_account_name=""),
           )
           print("Over budget: billing turned off")
   ```

3. Set **Function entry point** to `stop_billing`.
4. Click **Save and redeploy**, and wait until every step shows **Completed**.

### 6. Let the function turn billing off

1. Open **Billing**, then **Account management**, and check the billing account at the
   top is the one your project uses.
2. In the **Permissions** panel, click **Add principal**. If the panel is hidden, click
   **Show info panel**.
3. **New principals:** the function's service account from step 4, ending in
   `-compute@developer.gserviceaccount.com`.
4. **Role:** **Billing Account Administrator**.
5. Click **Save**.

Without this, the function can see that you're over budget but can't turn billing off.

### 7. Test it

This really turns billing off. You'll turn it back on straight afterwards.

1. Open **Pub/Sub**, **Topics**, `stop-billing`, then the **Messages** tab, and click
   **Publish message**.
2. **Message body:**

   ```json
   {"costAmount": 2, "budgetAmount": 1}
   ```

3. Click **Publish**, and wait about a minute.
4. Open **Cloud Run**, `stop-billing`, **Observability**, **Logs**. The newest line should
   say **Over budget: billing turned off**.

### 8. Turn billing back on

1. Open **Billing**. With your Scribecue project chosen, it says the project has no
   billing account.
2. Click **Link a billing account**, choose yours, and click **Set account**.

Google's voices work again straight away. The real budget messages report your actual
cost, so from now on the function only logs **Under budget** until you really go past $1
in a month.

## What happens from then on

- **Under $1 in a month:** nothing. The function logs **Under budget** a few times a day.
- **Over $1:** you get the budget emails, and billing is turned off for the project. Google
  reports costs a few hours late, so it turns off a little after the line, not on it: a
  few cents at Standard voice prices, not dollars. Scribecue shows Google's error when it
  tries a Google voice, and your other voices keep working.
- **Starting again:** link the billing account again, as in step 8, for example at the
  start of the next month. Within the same month, the function turns billing straight
  back off at the next budget message, since you're still over $1.
- **The setup itself costs nothing:** the function only runs when a budget message
  arrives, well within Cloud Run's free allowance.

## Privacy

- Each reading sends the block's text, as it's read aloud, to Google. Nothing else from
  your project goes with it.
- The key stays in your browser, kept apart from your other settings, and is only sent to
  Google. **Forget** removes it.
- Scribecue doesn't contact Google when it opens. The voice list is only fetched again
  when you change the key or open the text to speech settings.
- Requests carry only Scribecue's address, so the key's website restriction works, and no
  cookies.

## If something goes wrong

- **"Google didn't accept the key":** check you copied all of it, and that it's an API key
  from **Credentials**, not a service account key.
- **"The key is restricted to other websites":** add the address Scribecue shows to the
  key's **Website restrictions**, with `/*` on the end.
- **"Google refused: … API has not been used in project …":** the Cloud Text-to-Speech
  API isn't turned on for the key's project, or was only just turned on. Turn it on and
  wait a few minutes.
- **"Google refused: … billing …":** billing is off for the project, perhaps because the
  function turned it off. Check your budget emails, and link billing again if you mean to.
- **No Google voices in the list:** reopen the text to speech settings while you're
  online, so Scribecue can fetch the list.
- **The test didn't turn billing off:** look at the function's logs. A permission error
  means step 6 is missing. A different topic in the trigger, or no log line at all, means
  the trigger isn't on `stop-billing`: check the **Triggers** tab.
