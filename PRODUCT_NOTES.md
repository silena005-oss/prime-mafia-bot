# Prime Mafia Product Notes

## Monetization

- Product name for clubs: Maf Assist by Prime Mafia.
- Trial: first 7 days free for a new club, limited to 2 games.
- One-off game: minimum 1,000 RUB. It can remain as a support/manual option, not the main offer.
- Start package: 7,900 RUB/month for a beginning club.
- Club package: 12,900 RUB/month for an active club with individual rules and roles.
- Pro package: 19,900 RUB/month for a high-volume club.
- Network package: from 35,000 RUB/month for several clubs/cities.
- Standard monthly game limit for Start/Club: 12 games, 2 hosts included.
- Longer prepaid terms should be sold as 1/3/6/12 month subscriptions, not as a cheap annual plan.
- Annual price must not anchor at 36,000 RUB; that undervalues custom club rules, roles, scoring, ratings, and support.
- External installment payments should be available for 6-month and 12-month packages through a bank/payment partner such as T-Bank, Sber, YooKassa, CloudPayments, or Prodamus.
- Do not offer internal installment plans: the credit/payment risk must stay with the external provider.
- Club access is activated after the payment partner confirms the payment/installment approval.
- International payments are required for clubs outside Russia/CIS: card acquiring, payment links, invoices, and multi-currency support.
- Target international launch regions: Georgia, Armenia, UAE, Bali/Indonesia, and other cities with Russian-speaking or international Mafia communities.
- The bot and Mini App must support language switching in the user profile / club settings. Start with Russian and English; add Georgian, Armenian, and other local languages later based on demand.
- Club personalization: one-time 5000 RUB setup fee for a branded club table and role cards using the club's own uploaded card designs, matching their physical deck / brand book.
- Charge should happen when the game really starts: role deal in bot mode or "start game" in physical-card mode, not on the first "create game" click.

## Future Paid Flow

- Show host balance in the host menu.
- Add "Buy package", "Gift package", and "Activate promo code" actions.
- Support gift codes for 1 game or the 12-game package.
- Keep a 7-day free trial before requiring balance.

## Payment Methods

- Telegram payments for simple in-app purchases: one game, game packages, gifts, player frames, and announcement boosts.
- Bank card / SBP payment link for Russian clubs, issued from the host billing screen.
- External bank installment link for larger 6/12 month checks.
- International acquiring/payment links for non-Russian clubs: cards, invoices, and provider-specific links depending on country.
- Manual invoice for clubs and franchises that need payment by legal entity or bank transfer.
- Promo codes for ambassadors, partner clubs, trial extensions, and compensation after support cases.
- Internal balance in the host menu: paid games are deducted only when the host actually starts the game, not when a draft game is created.

## Paid Packages To Build

- Start: 7,900 RUB/month, 12 games, 2 hosts, one club, base setup, manual result entry, rating, and history.
- Club: 12,900 RUB/month, 12 games, 2 hosts, individual club rules, custom roles, club scoring system, announcements, player registration, evening reports, and setup support.
- Pro: 19,900 RUB/month, up to 30 games, up to 5 hosts, several rule presets, extended statistics, priority support, and Mini App preparation.
- Network: from 35,000 RUB/month, several clubs/cities, separate ratings, shared player base, admin access, and individual implementation.
- Prepaid terms: offer 1, 3, 6, and 12 months. Discounts may grow with term, but annual plans should still reflect the value of custom automation.
- Personalization: one-time branded table and role cards for 5000 RUB.
- Player cosmetics: paid profile frame, table badge, gift to another player, seasonal visual items.
- City announcement: paid game announcement in the app, filtered by city, starting from 300 RUB.

## Club Table Design Directions

- Classic Noir: black table, burgundy velvet, gold accents, premium private-club feeling.
- Pink Club: soft pink / black / champagne gold for clubs with a feminine glam identity.
- Royal Gold: black and deep gold with sharper contrast for expensive franchise-style clubs.
- Minimal Sport: dark graphite, clean numbers, high readability for tournaments and large tables.
- Custom Brand Book: club uploads its physical role cards, logo, colors, background texture, and preferred table style.

## Security And Access Protection

- Bot ownership must not depend on one personal Telegram account only. Keep a second trusted admin account added in BotFather / Telegram bot management where possible.
- Store the bot token only in Railway environment variables, never in code, screenshots, chats, or public docs.
- Enable 2FA on Telegram, Supabase, Railway, GitHub, email, and payment accounts. Use a password manager.
- Keep backup recovery codes for Telegram/email/password manager offline and in a second secure place.
- Add at least two Supabase project owners: the founder account and a backup admin account.
- Schedule database backups and export game/rating data regularly, especially before big refactors or production launches.
- Create an incident checklist: revoke bot token in BotFather, rotate Railway env vars, rotate Supabase keys, check GitHub deploy keys, review recent payments and admin actions.
- For club owners, limit permissions by role: host can run games, owner can pay/manage residents, super-admin can manage billing and global settings.

## Missing Product Pieces

- Admin billing screen: balance, package history, payment status, invoice links, promo codes.
- Support panel: club requests, failed payment cases, rating correction requests, old game import.
- Audit log: who changed scores, roles, club settings, residents, and payment status.
- Club onboarding wizard: city, club name, ruleset, scoring preset, logo/cards upload, host admins, trial start.
- Data export/import: CSV/Google Sheets import for past games and export for support review.
- Mini App public pages: club profile, upcoming games by city, player profile, rating, achievements.
- Notification strategy: game announcements, reminders, payment reminders, trial ending, rating updates.

## Adjacent Idea: Real Estate AI Agent

- Separate product idea: an AI agent for realtors that monitors market listings, keeps a base of owners, tracks price changes, and helps identify real owner contacts.
- Core modules: listing parser, duplicate detection, owner CRM, call/task history, price-change alerts, neighborhood analytics, and lead quality scoring.
- MVP angle: start with one city and one listing source, then expand to more portals and agencies.
- Main value: realtor spends less time manually checking listings and more time calling verified owners.
- Risk to study: legal limits of scraping, personal data processing, portal terms, and owner consent.

## Product Value

- Reduce dependence on highly experienced hosts: the app guides phases, timers, votes, night actions, scoring, and rankings.
- Help clubs onboard less experienced hosts faster, because the system handles the hard operational part of the game.
- Save post-game admin time: points, rankings, and game history are calculated immediately after the game.
- Reduce conflict with players by preventing common host mistakes when club rules are correctly configured.

## Club Scoring Mechanics

- Best move ("Лучший ход"): used in many clubs when a peaceful player is voted out on Day 1 or killed on Night 1 and correctly names mafia players.
- This should be a structured post-game field, not just a free-text bonus:
  - eligible player;
  - reason: voted out Day 1 or killed Night 1;
  - named mafia players;
  - how many guesses were correct;
  - bonus points from the club scoring settings.
- The host should be able to add it after the game from the results / bonus screen, and the bonus should be stored in `bonus_info` for transparency in the rating history.

## Future Game Modes

- Children's Mafia: adapted rules, softer roles, safer wording, and a simplified flow for kids' events.

## Legal Docs

- `LICENSE`: proprietary license, all rights reserved on code and project materials.
- `OFFERTA.md`: public offer for clubs, hosts, and players.
- `PRIVACY_POLICY.md`: personal data processing policy.
- `supabase/add_soglasie_igroki.sql`: DB columns for registration consent.
- Before accepting payments publicly, add operator legal details to the offer and get a final legal review.
