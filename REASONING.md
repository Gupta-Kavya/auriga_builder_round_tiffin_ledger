# REASONING.md

## How I approached it

I started with the main problem: a customer should pay only for the weekdays when their tiffin was due. I kept the app small, with one dashboard for adding customers, finding them by phone, pausing or resuming a plan, and checking the monthly bill.

For billing, I divide the monthly price by the total weekdays in that month. Then I count the eligible weekdays from the subscription start date, leaving out paused dates. For the current month, I count only up to today. The app currently assumes an unpaused weekday was delivered; it does not have a separate delivery confirmation feature.

## The three twists

For morning notifications, I added `/clock` to check who is due on a given date and `/outbox` to show the messages. I made repeat calls for the same date avoid duplicate messages. Since I was not given an external Notification Service API, I used a MongoDB-backed outbox.

For transfers, I kept the subscription and plan price the same but saved the dates for each customer who held it. The transfer date is the first day assigned to the new customer. This lets the monthly bill show each person’s delivered days and amount.

For imports, I accepted CSV rows, cleaned phone numbers and common date formats, and checked for duplicate phones. Invalid rows are reported separately, so one bad row does not stop the rest of the list.

## Testing and fixes

I tested the billing calculation with pauses, a mid-month start, and a partial current month. I added tests for weekday notification rules, the transfer date boundary, split bills, and messy import data. All six backend tests passed, and the frontend production build passed.

During the work, I found that the desktop copy was missing `.env.example`, even though the README referred to it, so I added it. I also adjusted the import parser to handle year-first dates and unambiguous month-first dates. I have not tested the full app against a running MongoDB instance, so that is still the main check I would do before submission.
