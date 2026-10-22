FULL APP UPDATE PROMPT — AUTOMATIC DERIV TRADING BOT

1. YOUR ROLE AND MAIN OBJECTIVE

Act as a senior full-stack developer, mobile UI/UX designer, trading automation engineer, and software architect.

You are working inside my existing application project. Your task is to inspect the entire codebase, understand the current architecture, and transform my existing manual Deriv trading bot into a fully automatic trading bot.

The new bot must use these two trading strategies:

1. Volatility Breakout
2. Reversal Strategy

The application must automatically analyze the market, identify valid trading signals, execute trades through the connected Deriv account, monitor open trades, record results, and stop trading when the user's configured limits are reached.

This is an update to my existing application, not a request to create an unrelated demo project.

Important: Do not simply redesign the home page. Inspect and update the complete project, including the frontend, backend, authentication, trading engine, API integrations, database, configuration, and application routing wherever necessary.

2. INSPECT THE ENTIRE PROJECT BEFORE MAKING CHANGES

Before implementation:

- Inspect every relevant directory and source file.
- Identify the frontend framework, backend framework, database, authentication system, and current application entry points.
- Find all existing manual-trading components, manual trade buttons, SmartChart frames, trading controls, obsolete pages, and related imports.
- Locate the existing Deriv API integration and determine whether it can be safely reused.
- Identify broken functionality, duplicate components, unused code, and dependencies that need updating.
- Check the existing environment variables and deployment configuration without exposing secrets.
- Understand the existing build, routing, state management, and server communication.

Create a clear implementation plan and then execute it.

Do not stop after producing a plan. Make the actual code changes, run available tests, and fix errors.

Remove the old interface

Completely remove the old manual-trading user interface and replace it with the new design specified below.

Delete the complete SmartChart frame and all project-owned SmartChart interface components, wrappers, imports, styles, and routes associated with that frame.

Remove obsolete manual-trading controls and unused UI code. Preserve unrelated functionality, essential project configuration, and any backend services that are still needed.

Do not delete the entire project or remove working authentication, API infrastructure, or trading logic without first understanding its purpose.

If the old trading engine is unsuitable, replace or refactor it rather than retaining manual trading behavior.

3. STRICT MOBILE-ONLY DESIGN

Build the application exclusively for mobile phones.

The application must feel like a genuine modern Android or iOS application, not a desktop website squeezed into a phone screen.

Design requirements:

- Mobile-first responsive layout.
- Support narrow Android screens and modern iPhones.
- Use a clean, light background.
- Use deep yellow as the primary action-button color.
- Use readable dark text, subtle borders, rounded cards, and balanced spacing.
- Include comfortable touch targets and clear active navigation states.
- Respect mobile safe areas, including the top status bar and bottom navigation area.
- Prevent horizontal scrolling and desktop-style overflow.
- Keep the interface compact, polished, and consistent.
- Use mobile-sized typography and realistic native-app spacing.
- Do not create a separate desktop or tablet layout.

The app should run on mobile browsers or its existing mobile app runtime. Do not claim that it is a native Android/iOS binary unless the project actually builds one.

4. APP AUTHENTICATION — NOT DERIV AUTHENTICATION

Build a new authentication system for users of MY APPLICATION.

This login and registration system is separate from Deriv authentication.

A new user must register or log in to my application before accessing the trading dashboard or connecting a Deriv account.

Registration page

Include:

- App logo.
- App name.
- Welcome heading.
- Full name.
- Email address.
- Password.
- Confirm password.
- Show/hide password control.
- Create Account button.
- Link to the Login page.
- Validation and clear error messages.

After successful registration:

1. Create the user's application account in the backend.
2. Generate a unique application account ID.
3. Save the user record securely.
4. Show a success notification.
5. Navigate to the main app or Deriv connection onboarding screen.

Login page

Include:

- App logo and app name.
- Email field.
- Password field.
- Show/hide password control.
- Login button.
- Link to Register.
- Loading state and validation messages.

Authenticate users through the actual backend authentication system. Persist sessions securely using the project's supported authentication architecture.

Do not use hardcoded demo accounts or fake authentication.

Users who are not authenticated must not be able to access protected application pages or trading endpoints.

5. AUTOMATIC APPLICATION ACCOUNT ID

Every registered user must receive a unique application account ID.

Example:

GQD-73737354

Requirements:

- Use the prefix "GQD-".
- Generate the numeric portion automatically.
- Guarantee uniqueness through a database constraint and collision handling.
- Generate and store the ID on the server, not only in the frontend.
- Never change an existing user's account ID during login.
- Display the ID on the user's Profile page.
- Allow administrators or authorized backend services to use this ID to identify the correct application user.
- Never use this ID as a substitute for authentication or authorization.

The application account ID identifies the user of my app. It is not a Deriv account ID.

6. MAIN APPLICATION HEADER

Display a consistent app header on the main authenticated screens.

Left side:

- App logo.
- App name.

Right side:

- User profile image or initials avatar.
- App logout icon/button.

The header logout action must log the user out of MY APPLICATION only.

It must not disconnect the user's Deriv account automatically.

Use a compact mobile header with proper spacing and alignment.

7. FIXED BOTTOM NAVIGATION

Create a fixed bottom navigation bar with exactly four primary navigation items:

1. Home
2. Configure
3. Chat
4. Profile

Each item must include an appropriate icon and a readable label.

Requirements:

- Highlight the active page using the deep-yellow accent.
- Keep the navigation fixed to the bottom of the screen.
- Respect device safe areas.
- Prevent the navigation bar from covering important content.
- Use smooth, lightweight page transitions where appropriate.
- Make all four navigation items functional.
- Keep the overall design consistent with Android and iOS application conventions.

On the Home page, make the console area extend visually down to the bottom navigation when the user reaches the end of the page, with no unnecessary blank gap between the console card and navigation bar.

Ensure the console remains usable and that the fixed navigation does not cover console entries.

8. HOME PAGE

Build a clean mobile dashboard containing three main cards.

CARD A — DERIV ACCOUNT AND TRADING STATISTICS

Display the connected Deriv account's actual balance and trading statistics.

Include:

- Account balance.
- Profit/Loss (P/L).
- Wins (W).
- Losses (L).
- Win rate (%).

Example layout:

Balance: $10.00

P/L: +$2.50

W: 7

L: 3

Win Rate: 70%

All displayed values are examples only. Once the app is connected, load real values from the backend and Deriv API where appropriate.

Requirements:

- Use USD formatting with the "$" symbol for displayed currency amounts.
- Do not use naira.
- Format monetary values to two decimal places.
- Use green for positive P/L and red for negative P/L.
- Display zero or a clearly labeled connection state when actual account data is unavailable.
- Never fabricate account balances, trading results, or win rates.
- Update statistics after trade settlements.
- Clearly distinguish the Deriv account balance from the bot's calculated trading P/L.
- Calculate win rate from settled trades using a consistent definition.

If the connected Deriv account uses a currency other than USD, do not mislabel its balance as USD or silently convert it without an actual exchange-rate source.

CARD B — AUTOMATIC TRADING CONTROLS

Create one card containing:

- Bot status indicator.
- Start button.
- Stop button.
- Current strategy status.
- Optional current market/symbol indicator.

The Start button must start the actual automated trading service for the authenticated user.

The Stop button must request the actual trading engine to stop opening new trades.

Requirements:

- Start only when the user has a valid Deriv connection, appropriate permissions, valid configuration, and sufficient available funds.
- Show a clear message when the bot cannot start.
- Prevent duplicate bot instances.
- Prevent multiple simultaneous starts from creating duplicate trades.
- Show accurate states such as Stopped, Connecting, Running, Stopping, and Error.
- Keep the frontend synchronized with the actual backend bot state.
- Provide clear confirmation or feedback when stopping.
- Handle network interruptions and reconnections safely.
- Never show Running merely because the Start button was clicked.

Stopping the bot must immediately prevent new trades from being initiated once the backend processes the stop request. Handle already-open contracts according to a clearly defined policy and communicate their status to the user. Do not silently place additional trades after stopping.

CARD C — LIVE CONSOLE LOG

Create a full-width console card.

Required console height: 250px.

The console card must stretch across the full available content width, aligned with the left and right edges of the app content.

Console requirements:

- Height: 250px.
- Full available width.
- Dark console surface within the light app design.
- Compact, readable, monospace log text.
- Newest log entries displayed at the TOP, not the bottom.
- Automatically insert each new event at the beginning of the log.
- Preserve chronological timestamps on every entry.
- Support vertical scrolling when the log becomes long.
- Avoid unnecessary spacing between console entries.
- Display useful status messages rather than raw, confusing technical output.

Example console entries:

19:30:10 — Application initialized.

19:30:12 — Connecting to Deriv API.

19:30:13 — Deriv account connected.

19:30:15 — Automatic trading engine ready.

19:30:18 — Analyzing volatility breakout conditions.

19:30:20 — No valid entry signal detected.

19:30:25 — Reversal conditions under analysis.

19:30:28 — Trading engine waiting for a valid signal.

These are examples of the desired message format, not events to fabricate.

Actual console events must originate from real application and trading-engine activity.

Use appropriate log categories such as INFO, SUCCESS, WARNING, TRADE, and ERROR.

Keep the console card positioned as the final main content area of the Home page. When the user scrolls to the bottom, it should meet the bottom navigation without a blank spacer or unnecessary margin.

9. CONFIGURE PAGE

Build a mobile configuration screen where users can set their automatic trading parameters.

Include these fields:

Stake Amount

The amount to risk or stake on each trade, denominated in the connected account's currency.

Example: "$1.00".

Validate against supported minimum and maximum stake limits.

Target Profit

The profit threshold at which the bot stops initiating new trades.

Example: "$5.00".

Use the user's configured target as a session-level profit target, based on a clearly defined P/L calculation.

Target Loss

The maximum permitted session loss before the bot stops initiating new trades.

Example: "$3.00".

Additional strategy settings

Include the following settings if supported by the actual trading engine:

- Strategy selection: Volatility Breakout, Reversal, or Both.
- Supported market/symbol selection.
- Trade duration or contract duration.
- Maximum trades per session.
- Maximum consecutive losses.
- Optional cooldown after a losing trade.

Keep the three required settings—Stake Amount, Target Profit, and Target Loss—prominent.

Save button

Add a clearly visible deep-yellow Save Configuration button.

On save:

1. Validate all values.
2. Display a full-screen transparent loading overlay with a centered spinning indicator.
3. Keep the overlay visible for at least five seconds while the request is in progress, unless an error or cancellation requires an earlier exit.
4. Submit the configuration to the backend.
5. Wait for the real server response.
6. Save the validated configuration persistently.
7. Display a top-of-screen success or error notification.
8. Remove the loading overlay only when the operation has completed and its minimum display duration has elapsed.

The five-second minimum is a minimum loading-indicator display time, not a reason to delay sending the request to the server.

Never display a success message before the server confirms the save.

The backend must independently validate all trading parameters. A malicious or modified frontend must not be able to bypass risk limits.

10. CHAT PAGE

Build the Chat page now, but do not implement the chat system yet.

Display:

- A simple chat icon or illustration.
- Heading: Chat.
- Message: Coming Soon.
- A short subtitle indicating that the feature is being developed.

Keep the page visually consistent with the rest of the application.

Do not add fake chat messages, nonfunctional message input, or simulated conversations.

11. PROFILE PAGE

Build a Profile page containing the current authenticated user's application information.

Display:

- Profile image or initials avatar.
- Full name.
- Email address.
- Application account ID, for example "GQD-73737354".
- Date joined.
- Deriv connection status.
- Connected Deriv account identifier where available and appropriate.

Retrieve profile information from the authenticated backend user record.

Do not expose access tokens, passwords, secret keys, or other credentials.

At the bottom of the Profile page, add a clearly separated button:

Disconnect Deriv Account

This button is specifically for disconnecting the user's Deriv account, not logging out of my application.

On disconnection:

1. Confirm the user's action.
2. Stop the user's bot from opening new trades.
3. Handle existing contracts safely according to the documented contract-management policy.
4. Revoke or invalidate the Deriv session/token where supported and appropriate.
5. Remove or invalidate locally stored Deriv credentials.
6. Update the connection state.
7. Display a top-of-screen notification.

Disconnecting Deriv must not delete the user's application account or automatically log them out of my app.

12. CONNECT DERIV ACCOUNT

After registering or logging in to my application, users must be able to connect their own Deriv accounts.

Implement a real Deriv connection flow using the currently supported official Deriv API and authentication mechanisms.

Requirements:

- Display a Connect Deriv Account action when no account is connected.
- Use the supported Deriv authorization/OAuth flow or official token authorization method appropriate to the integration.
- Explain the permissions required for market data and trading.
- Request only the permissions actually required.
- Validate authorization and retrieve the actual authorized account details.
- Associate the authorized Deriv account with the correct authenticated application user on the backend.
- Verify that the authorized account is permitted to trade before enabling automatic trading.
- Handle expired authorization, revoked access, connection loss, API errors, and account switching.
- Never request or store the user's Deriv password.
- Never place secret API tokens in frontend source code, browser storage, public environment variables, or client-side logs.
- Never expose one user's Deriv credentials or account information to another user.
- Never assume a Deriv account is connected just because the user has supplied an account ID.

Do not create a fake Deriv connection or return hardcoded balances.

13. AUTOMATIC TRADING ENGINE

Implement the actual automated trading engine using the two requested strategies.

The engine must run independently of the visible UI. It must not rely on the user keeping the Home page open to continue monitoring trades.

Strategy A — Volatility Breakout

Develop a configurable volatility breakout strategy that:

1. Subscribes to actual supported market prices or candles.
2. Builds a defined analysis window from market data.
3. Calculates the selected breakout range.
4. Determines the relevant upper and lower breakout boundaries.
5. Uses a configurable volatility filter or range-expansion condition.
6. Confirms a breakout using defined price conditions.
7. Rejects invalid signals and duplicate entries.
8. Validates the intended trade against the user's risk configuration.
9. Requests a valid trade quote and executes only an eligible contract.
10. Tracks the result until settlement.

Make the range length, breakout confirmation method, volatility filter, and other strategy parameters explicit and configurable in the engine.

Do not enter trades based solely on arbitrary price movements or unverified indicators.

Strategy B — Reversal

Implement a defined reversal strategy that:

1. Reads actual market data.
2. Identifies a configurable analysis range.
3. Detects a potential overextension, rejection, or reversal pattern.
4. Uses explicit confirmation conditions before creating an entry signal.
5. Filters weak, conflicting, and duplicate signals.
6. Validates stake, account status, risk limits, and contract availability.
7. Requests and validates an eligible contract quote.
8. Executes through the authorized Deriv API.
9. Tracks the contract to settlement and records the actual result.

Make reversal conditions, confirmation rules, and any indicator thresholds explicit in the implementation.

Do not promise profitability or assume that either strategy guarantees winning trades.

Strategy selection

Allow users to select:

- Volatility Breakout.
- Reversal.
- Both strategies.

When Both is selected, implement conflict resolution and trade deduplication so simultaneous signals cannot create uncontrolled duplicate trades.

Execution safeguards

Before every trade, verify:

- The application user is authenticated.
- The correct Deriv account is authorized.
- The bot is actually running.
- The configuration is valid.
- The target profit has not been reached.
- The target loss has not been reached.
- The stake is permitted.
- The account has sufficient available funds.
- The market and contract type are supported.
- No duplicate or conflicting trade is being submitted.
- The current risk and trade limits allow another trade.

Use server-side enforcement for all critical checks.

14. PROFIT AND LOSS RISK MANAGEMENT

Implement session-based risk controls that use actual settled trading results.

Track:

- Session starting balance or a clearly defined session baseline.
- Realized profit and loss.
- Wins.
- Losses.
- Win rate.
- Total trades.
- Current session status.
- Target profit.
- Target loss.

Define clearly how fees, payouts, refunds, void contracts, and other settlement outcomes affect the statistics and risk limits.

When the profit target is reached:

- Stop initiating new trades.
- Update the bot status.
- Record the reason for stopping.
- Notify the user.

When the loss limit is reached:

- Stop initiating new trades.
- Update the bot status.
- Record the reason for stopping.
- Notify the user.

Enforce these controls in the backend, not merely in frontend JavaScript.

Use a and also use neo as the database 
