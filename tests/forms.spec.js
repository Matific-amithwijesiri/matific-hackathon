const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');
const { DashboardPage } = require('../pages/DashboardPage');
const { ContactFormPage } = require('../pages/ContactFormPage');
const { RegistrationFormPage } = require('../pages/RegistrationFormPage');
const { FeedbackFormPage } = require('../pages/FeedbackFormPage');
const { HelpPage } = require('../pages/HelpPage');

test.describe('Bootstrap Forms Automation using POM', () => {
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await test.step('Open login page and verify UI', async () => {
      await loginPage.goto();
      await expect(loginPage.welcomeHeading).toBeVisible();
      await expect(loginPage.emailInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.demoCredentialsHint).toBeVisible();
      await expect(loginPage.loginError).toBeHidden();
    });
    await test.step('Sign in with valid demo credentials', async () => {
      await loginPage.login('demo@example.com', '123456');
      await expect(page).toHaveURL(/dashboard\.html/);
    });
  });

  test('TC01 - valid login lands on dashboard', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await test.step('Verify dashboard page title and URL', async () => {
      await expect(page).toHaveTitle(/Dashboard/i);
      await expect(page).toHaveURL(/dashboard\.html/);
      await expect(dashboardPage.title).toBeVisible();
      await expect(dashboardPage.subtitle).toBeVisible();
    });
    await test.step('Verify all form entry cards and descriptions', async () => {
      await expect(dashboardPage.contactFormLink).toBeVisible();
      await expect(dashboardPage.registrationFormLink).toBeVisible();
      await expect(dashboardPage.feedbackFormLink).toBeVisible();
      await expect(dashboardPage.helpCenterLink).toBeVisible();
      await expect(dashboardPage.contactCardDescription).toBeVisible();
      await expect(dashboardPage.registrationCardDescription).toBeVisible();
      await expect(dashboardPage.feedbackCardDescription).toBeVisible();
      await expect(dashboardPage.helpCardDescription).toBeVisible();
    });
    await test.step('Verify logout control is available', async () => {
      await expect(dashboardPage.logoutButton).toBeVisible();
    });
  });

  test('TC02 - fill and submit contact form', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    const contactFormPage = new ContactFormPage(page);

    await test.step('Navigate from dashboard to contact form', async () => {
      await dashboardPage.gotoContactForm();
      await expect(page).toHaveURL(/forms\.html/);
      await expect(page).toHaveTitle(/Contact Form/i);
      await expect(contactFormPage.title).toBeVisible();
      await expect(contactFormPage.backToDashboardLink).toBeVisible();
    });
    await test.step('Assert fields start empty', async () => {
      await expect(contactFormPage.nameInput).toBeEmpty();
      await expect(contactFormPage.emailInput).toBeEmpty();
      await expect(contactFormPage.messageInput).toBeEmpty();
    });
    await test.step('Fill form, clear name once, and tab to next field', async () => {
      await contactFormPage.nameInput.fill('Draft');
      await contactFormPage.nameInput.clear();
      await contactFormPage.fillForm('Amith', 'amith@example.com', 'This is a test message from Playwright.');
      await contactFormPage.nameInput.press('Tab');
      await expect(contactFormPage.emailInput).toBeFocused();
    });
    await test.step('First submit — verify success message and field values', async () => {
      await expect(contactFormPage.submitButton).toBeEnabled();
      await contactFormPage.submit();
      await expect(contactFormPage.successMessage).toBeVisible();
      await expect(contactFormPage.successMessage).toHaveAttribute('role', 'alert');
      await expect(contactFormPage.successMessage).toHaveText('Contact form submitted successfully');
      await expect(contactFormPage.nameInput).toHaveValue('Amith');
      await expect(contactFormPage.emailInput).toHaveValue('amith@example.com');
      await expect(contactFormPage.messageInput).toHaveValue('This is a test message from Playwright.');
    });
    await test.step('Second submit — overwrite all fields and assert new success state', async () => {
      await contactFormPage.fillForm(
        'Jordan Lee',
        'jordan.qa@example.com',
        'Follow-up message: regression pass after UI locator refresh.'
      );
      await contactFormPage.submit();
      await expect(contactFormPage.successMessage).toHaveText('Contact form submitted successfully');
      await expect(contactFormPage.nameInput).toHaveValue('Jordan Lee');
      await expect(contactFormPage.emailInput).toHaveValue('jordan.qa@example.com');
      await expect(contactFormPage.messageInput).toHaveValue(
        'Follow-up message: regression pass after UI locator refresh.'
      );
    });
    await test.step('Return to dashboard via back link', async () => {
      await contactFormPage.goBackToDashboard();
      await expect(page).toHaveURL(/dashboard\.html/);
      await expect(dashboardPage.title).toBeVisible();
    });
  });

  test('TC03 - fill and submit registration form', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    const registrationFormPage = new RegistrationFormPage(page);

    await test.step('Navigate from dashboard to registration form', async () => {
      await dashboardPage.gotoRegistrationForm();
      await expect(page).toHaveURL(/form2\.html/);
      await expect(page).toHaveTitle(/Registration Form/i);
      await expect(registrationFormPage.title).toBeVisible();
      await expect(registrationFormPage.backToDashboardLink).toBeVisible();
    });
    await test.step('First profile — credentials and Admin role', async () => {
      await expect(registrationFormPage.roleSelect).toHaveValue('');
      await registrationFormPage.usernameInput.fill('playwrightUser');
      await registrationFormPage.passwordInput.fill('Password@123');
      await registrationFormPage.roleSelect.selectOption('User');
      await expect(registrationFormPage.roleSelect).toHaveValue('User');
      await registrationFormPage.roleSelect.selectOption('Admin');
      await expect(registrationFormPage.roleSelect).toHaveValue('Admin');
    });
    await test.step('First submit — verify success and persisted values', async () => {
      await expect(registrationFormPage.submitButton).toBeEnabled();
      await registrationFormPage.submit();
      await expect(registrationFormPage.successMessage).toBeVisible();
      await expect(registrationFormPage.successMessage).toHaveAttribute('role', 'alert');
      await expect(registrationFormPage.successMessage).toHaveText('Registration form submitted successfully');
      await expect(registrationFormPage.usernameInput).toHaveValue('playwrightUser');
      await expect(registrationFormPage.passwordInput).toHaveValue('Password@123');
      await expect(registrationFormPage.roleSelect).toHaveValue('Admin');
    });
    await test.step('Second profile — new user as standard User', async () => {
      await registrationFormPage.usernameInput.fill('qaOperatorTwo');
      await registrationFormPage.passwordInput.fill('DifferentPass@999');
      await registrationFormPage.roleSelect.selectOption('User');
      await expect(registrationFormPage.roleSelect).toHaveValue('User');
    });
    await test.step('Second submit — verify updated values and success', async () => {
      await registrationFormPage.submit();
      await expect(registrationFormPage.successMessage).toHaveText('Registration form submitted successfully');
      await expect(registrationFormPage.usernameInput).toHaveValue('qaOperatorTwo');
      await expect(registrationFormPage.passwordInput).toHaveValue('DifferentPass@999');
      await expect(registrationFormPage.roleSelect).toHaveValue('User');
    });
    await test.step('Return to dashboard via back link', async () => {
      await registrationFormPage.goBackToDashboard();
      await expect(page).toHaveURL(/dashboard\.html/);
      await expect(dashboardPage.title).toBeVisible();
    });
  });

  test('TC04 - fill and submit feedback form', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    const feedbackFormPage = new FeedbackFormPage(page);

    await test.step('Navigate from dashboard to feedback form', async () => {
      await dashboardPage.gotoFeedbackForm();
      await expect(page).toHaveURL(/form3\.html/);
      await expect(page).toHaveTitle(/Feedback Form/i);
      await expect(feedbackFormPage.title).toBeVisible();
      await expect(feedbackFormPage.backToDashboardLink).toBeVisible();
    });
    await test.step('Verify rating range and adjust slider', async () => {
      await expect(feedbackFormPage.ratingSlider).toHaveAttribute('min', '1');
      await expect(feedbackFormPage.ratingSlider).toHaveAttribute('max', '10');
      await expect(feedbackFormPage.ratingSlider).toHaveValue('5');
      await feedbackFormPage.ratingSlider.fill('3');
      await expect(feedbackFormPage.ratingSlider).toHaveValue('3');
    });
    await test.step('First round — subject, feedback, rating 8', async () => {
      await feedbackFormPage.fillForm(
        'Website Review',
        'The dashboard and forms are working well. This feedback was submitted with Playwright.',
        8
      );
      await expect(feedbackFormPage.ratingSlider).toHaveValue('8');
    });
    await test.step('First submit — verify success includes rating 8', async () => {
      await expect(feedbackFormPage.submitButton).toBeEnabled();
      await feedbackFormPage.submit();
      await expect(feedbackFormPage.successMessage).toBeVisible();
      await expect(feedbackFormPage.successMessage).toHaveAttribute('role', 'alert');
      await expect(feedbackFormPage.successMessage).toContainText('Feedback form submitted successfully');
      await expect(feedbackFormPage.successMessage).toContainText('rating 8');
      await expect(feedbackFormPage.subjectInput).toHaveValue('Website Review');
      await expect(feedbackFormPage.feedbackInput).toHaveValue(
        'The dashboard and forms are working well. This feedback was submitted with Playwright.'
      );
    });
    await test.step('Second round — new copy and boundary rating 10', async () => {
      await feedbackFormPage.fillForm(
        'Nightly automation',
        'Second submission: checking max slider value and message refresh.',
        10
      );
      await expect(feedbackFormPage.ratingSlider).toHaveValue('10');
    });
    await test.step('Second submit — verify success includes rating 10', async () => {
      await feedbackFormPage.submit();
      await expect(feedbackFormPage.successMessage).toContainText('rating 10');
      await expect(feedbackFormPage.subjectInput).toHaveValue('Nightly automation');
      await expect(feedbackFormPage.feedbackInput).toHaveValue(
        'Second submission: checking max slider value and message refresh.'
      );
    });
    await test.step('Return to dashboard via back link', async () => {
      await feedbackFormPage.goBackToDashboard();
      await expect(page).toHaveURL(/dashboard\.html/);
      await expect(dashboardPage.title).toBeVisible();
    });
  });

  test('TC05 - logout returns user to login page', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    const loginPage = new LoginPage(page);

    await test.step('Confirm user is on dashboard with logout available', async () => {
      await expect(page).toHaveURL(/dashboard\.html/);
      await expect(dashboardPage.title).toBeVisible();
      await expect(dashboardPage.logoutButton).toBeVisible();
    });
    await test.step('Click logout', async () => {
      await dashboardPage.logout();
    });
    await test.step('Verify login page is shown with clean error state', async () => {
      await expect(page).toHaveURL(/index\.html/);
      await expect(page).toHaveTitle(/Login/i);
      await expect(loginPage.welcomeHeading).toBeVisible();
      await expect(loginPage.submitButton).toBeVisible();
      await expect(loginPage.loginError).toBeHidden();
      await expect(loginPage.demoCredentialsHint).toBeVisible();
    });
  });

  test.describe('Extended end-to-end journeys', () => {
    test('TC07 - full tour: help center then every form and logout', async ({ page }) => {
      const dashboardPage = new DashboardPage(page);
      const helpPage = new HelpPage(page);
      const contactFormPage = new ContactFormPage(page);
      const registrationFormPage = new RegistrationFormPage(page);
      const feedbackFormPage = new FeedbackFormPage(page);
      const loginPage = new LoginPage(page);

      await test.step('Open Help Center from dashboard', async () => {
        await dashboardPage.gotoHelpCenter();
        await expect(page).toHaveURL(/help\.html/);
        await expect(page).toHaveTitle(/Help Center/i);
        await expect(helpPage.title).toBeVisible();
        await expect(helpPage.intro).toBeVisible();
        await expect(helpPage.accordion).toBeVisible();
      });
      await test.step('Review Help — all FAQ sections and footer', async () => {
        await expect(helpPage.faqContactBody).toBeVisible();
        await expect(helpPage.faqRegistrationTrigger).toBeVisible();
        await expect(helpPage.faqRegistrationBody).toBeVisible();
        await expect(helpPage.faqFeedbackTrigger).toBeVisible();
        await expect(helpPage.faqFeedbackBody).toBeVisible();
        await expect(helpPage.footerNote).toBeVisible();
      });
      await test.step('Return to dashboard from Help', async () => {
        await helpPage.goBackToDashboard();
        await expect(page).toHaveURL(/dashboard\.html/);
        await expect(dashboardPage.title).toBeVisible();
      });
      await test.step('Contact form — complete and return', async () => {
        await dashboardPage.gotoContactForm();
        await contactFormPage.fillForm('Tour User', 'tour@example.com', 'End-to-end tour: contact step.');
        await contactFormPage.submit();
        await expect(contactFormPage.successMessage).toHaveText('Contact form submitted successfully');
        await contactFormPage.goBackToDashboard();
        await expect(page).toHaveURL(/dashboard\.html/);
      });
      await test.step('Registration form — User role and return', async () => {
        await dashboardPage.gotoRegistrationForm();
        await registrationFormPage.usernameInput.fill('e2eTourUser');
        await registrationFormPage.passwordInput.fill('TourPass@456');
        await registrationFormPage.roleSelect.selectOption('User');
        await registrationFormPage.submit();
        await expect(registrationFormPage.successMessage).toHaveText('Registration form submitted successfully');
        await registrationFormPage.goBackToDashboard();
        await expect(page).toHaveURL(/dashboard\.html/);
      });
      await test.step('Feedback form — mid rating then return', async () => {
        await dashboardPage.gotoFeedbackForm();
        await feedbackFormPage.fillForm('E2E tour', 'Sequential navigation across all app forms.', 6);
        await feedbackFormPage.submit();
        await expect(feedbackFormPage.successMessage).toContainText('rating 6');
        await feedbackFormPage.goBackToDashboard();
        await expect(page).toHaveURL(/dashboard\.html/);
      });
      await test.step('Re-open Help briefly then dashboard sanity', async () => {
        await dashboardPage.gotoHelpCenter();
        await expect(helpPage.title).toBeVisible();
        await helpPage.goBackToDashboard();
        await expect(dashboardPage.contactFormLink).toBeVisible();
        await expect(dashboardPage.registrationFormLink).toBeVisible();
        await expect(dashboardPage.feedbackFormLink).toBeVisible();
        await expect(dashboardPage.helpCenterLink).toBeVisible();
      });
      await test.step('Logout and confirm login shell', async () => {
        await dashboardPage.logout();
        await expect(page).toHaveURL(/index\.html/);
        await expect(loginPage.welcomeHeading).toBeVisible();
        await expect(loginPage.loginError).toBeHidden();
      });
    });

    test('TC08 - dashboard round-trip across forms without submit then full submits', async ({ page }) => {
      const dashboardPage = new DashboardPage(page);
      const contactFormPage = new ContactFormPage(page);
      const registrationFormPage = new RegistrationFormPage(page);
      const feedbackFormPage = new FeedbackFormPage(page);

      await test.step('Preview each form page and return (no submit)', async () => {
        await dashboardPage.gotoContactForm();
        await expect(contactFormPage.title).toBeVisible();
        await contactFormPage.goBackToDashboard();
        await dashboardPage.gotoRegistrationForm();
        await expect(registrationFormPage.title).toBeVisible();
        await registrationFormPage.goBackToDashboard();
        await dashboardPage.gotoFeedbackForm();
        await expect(feedbackFormPage.title).toBeVisible();
        await feedbackFormPage.goBackToDashboard();
        await expect(page).toHaveURL(/dashboard\.html/);
      });
      await test.step('Contact — third message line for volume check', async () => {
        await dashboardPage.gotoContactForm();
        await contactFormPage.fillForm('Pat', 'pat@example.com', 'Third distinct payload for longer scenario.');
        await contactFormPage.submit();
        await expect(contactFormPage.successMessage).toBeVisible();
        await contactFormPage.fillForm('Pat', 'pat@example.com', 'Fourth payload — same user, new message body.');
        await contactFormPage.submit();
        await expect(contactFormPage.messageInput).toHaveValue('Fourth payload — same user, new message body.');
        await contactFormPage.goBackToDashboard();
      });
      await test.step('Registration — toggle roles before final Admin', async () => {
        await dashboardPage.gotoRegistrationForm();
        await registrationFormPage.usernameInput.fill('roundTripUser');
        await registrationFormPage.passwordInput.fill('Round@789');
        await registrationFormPage.roleSelect.selectOption('Admin');
        await registrationFormPage.roleSelect.selectOption('User');
        await registrationFormPage.roleSelect.selectOption('Admin');
        await registrationFormPage.submit();
        await expect(registrationFormPage.roleSelect).toHaveValue('Admin');
        await registrationFormPage.goBackToDashboard();
      });
      await test.step('Feedback — sweep low and high ratings', async () => {
        await dashboardPage.gotoFeedbackForm();
        await feedbackFormPage.ratingSlider.fill('1');
        await feedbackFormPage.subjectInput.fill('Low rating');
        await feedbackFormPage.feedbackInput.fill('Min rating check.');
        await feedbackFormPage.submit();
        await expect(feedbackFormPage.successMessage).toContainText('rating 1');
        await feedbackFormPage.fillForm('High rating', 'Max rating check.', 10);
        await feedbackFormPage.submit();
        await expect(feedbackFormPage.successMessage).toContainText('rating 10');
        await feedbackFormPage.goBackToDashboard();
        await expect(dashboardPage.title).toBeVisible();
      });
    });
  });
});

test.describe('Login validation', () => {
  test('TC06 - invalid credentials show error and stay on login', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await test.step('Open login page', async () => {
      await loginPage.goto();
      await expect(loginPage.welcomeHeading).toBeVisible();
    });
    await test.step('Enter invalid email and password', async () => {
      await loginPage.login('wrong@example.com', 'wrongpassword');
    });
    await test.step('Assert error is shown and user remains on login', async () => {
      await expect(page).toHaveURL(/index\.html/);
      await expect(loginPage.loginError).toBeVisible();
      await expect(loginPage.loginError).toHaveText('Invalid email or password');
      await expect(loginPage.loginError).not.toHaveClass(/d-none/);
      await expect(loginPage.emailInput).toHaveValue('wrong@example.com');
    });
  });
});
