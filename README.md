# Cav Fitness Scraper

This script scrapes the weekly mission from https://thecavfitness.com/middletown/
so that I don't have to look it up every week manually.

## Testing locally

To test locally create a `.env` file with the following content:

```
DKIM_PRIVATE_KEY='-----BEGIN RSA PRIVATE KEY-----\n' +
    'your\n' +
    'private\n' +
    'key=\n' +
    '-----END RSA PRIVATE KEY-----';
EMAIL_PASSWORD='yourpassword'
EMAIL_ADDRESSES='example@example.com,foo@bar.com'
DRY_RUN=true
```

## Example

![mission image](data/mission.png)
