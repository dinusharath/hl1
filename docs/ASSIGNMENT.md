# Processing Forms

At Healthtech-1, one of our core responsibilities is to:

* Ingest registration forms
* Transform them
* Update some external systems
* ...and get them ready for future processing (by a `FORM-BOT`).

As this is important healthcare data, we need to design systems which are resilient to any errors (in our system or elsewhere!) which may occur. Wherever possible this shouldn't require human recovery - we don't want to page the on-call unncessarily! Some decisions still may need a human to be involved.

Your task is to code a system for ingesting and processing these registration forms in a robust way.

Let us suppose the service which sends these forms is particularly untrustworthy - we can expect them to make schema changes without informing us, send duplicate forms, or generally just be badly behaved!

To be explicit, we would expect to see things like:

* An implemented `/ingest` HTTP endpoint and appropriate storage in a persistent database.
* Be able to accept a payload which conforms to the currently agreed schema.
  * This schema is found in `ingested_schema.ts`.
  * Note: As above, this data source isn't 100% reliable and schema changes aren't always communicated in a timely fashion! If the schema changes in an unexpected way, you can assume we can handle the change without needing to reject the message (for example, if the provider stops sending `email` and starts sending `work_email/home_email`, then we can retroactively fix this)
* Enrich the provided data with a `longitude` and `latitude` so that we have specific address information for the `FORM-BOT`.
  * A mock implementation of a geocoding API (to transform the postcode into `latitude/longitude`) is provided.
* Thus, the data should eventually conform to the schema in `transformed_schema.ts`.
* Appropriate delivery mechanisms to our email provider/the `FORM-BOT`.

Some additional expectations for the system

* The third party external provider does not guarantee exactly once delivery, so we should be prepared to handle multiple deliveries smoothly.
* If the transform is successful, we must send a guaranteed email to our team `happyforms@bots.com` that a form was ingested
* We should never give the `FORM-BOT` the same form twice (don't worry, we promise `FORM-BOT` never crashes!)

Some general expectations

* We expect you to add some basic tests to your code
* We expect you to use an actual database, as we'd like to see your schema design
* You are free to use AI to aid you in this task - please be prepared to "justify" the decisions Claude has made!
* You are free to choose libraries/technologies that you are comfortable with - please be prepared to explain their use/value.
* You may choose another language if you are unfamiliar with Typescript, although drop us a note to let us know.
  * Note: Our stack is Typescript - so you'll be expected to become skilled with it. However - we want to make sure you have your best shot of building this system.

How to submit

* The email sent to you has a unique submission link, which will take you to a submission portal
* Please submit on the portal: a link to your repository and a link to a 5 minute (max) loom which explains your code and some of your design decisions
* If possible, please submit within 4-5 days of receiving the task
