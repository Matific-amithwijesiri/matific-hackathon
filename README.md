# Playwright POM Project

This project automates a simple Bootstrap website using the **Page Object Model (POM)** with **5 test cases**.

## Covered flows
1. Login with valid credentials
2. Fill Contact Form
3. Fill Registration Form
4. Fill Feedback Form
5. Logout

## Project structure
- `app/` -> HTML website under test
- `pages/` -> page object classes
- `tests/` -> Playwright tests
- `playwright.config.js` -> Playwright configuration

## Setup
```bash
npm install
npx playwright install
```

## Run tests
```bash
npm test
```

## Run headed
```bash
npm run test:headed
```

## Open HTML report
```bash
npm run report
```

## Demo login
- Email: `demo@example.com`
- Password: `123456`