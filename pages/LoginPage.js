/**
 * Login (index.html) — locator strategies:
 * | Strategy      | Examples |
 * |---------------|----------|
 * | data-testid   | login-email, login-password, login-submit, login-error, login-demo-hint, login-welcome-heading |
 * | id            | email, password, loginButton, loginError (used by app.js) |
 * | name          | email, password |
 * | class         | app-page--login, app-login-card, app-input-login-email, app-btn-login |
 * | data-gtm-id   | login_field_email, login_field_password, login_submit, login_error, login_demo_hint |
 * | data-page     | body[data-page="login"] |
 */
class LoginPage {
  constructor(page) {
    this.page = page;
    this.welcomeHeading = page.getByTestId('login-welcome-heading');
    this.emailInput = page.getByTestId('login-email');
    this.passwordInput = page.getByTestId('login-password');
    this.submitButton = page.getByTestId('login-submit');
    this.loginError = page.getByTestId('login-error');
    this.demoCredentialsHint = page.getByTestId('login-demo-hint');
  }

  async goto() {
    await this.page.goto('/index.html');
  }

  async login(email, password) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}

module.exports = { LoginPage };
