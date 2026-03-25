/**
 * Registration form (form2.html) — locator strategies:
 * | Strategy      | Examples |
 * |---------------|----------|
 * | data-testid   | registration-form-title, registration-username, registration-password, registration-role, registration-submit, registration-success, registration-back-dashboard |
 * | id            | registrationForm, username, registerPassword, role, registrationSubmit, registrationSuccess |
 * | name          | registration (form), username, registration_password, role |
 * | class         | app-page--registration-form, app-form-registration, app-select-registration-role |
 * | data-gtm-id   | registration_field_username, registration_submit, … |
 * | data-page     | body[data-page="registration-form"] |
 */
class RegistrationFormPage {
  constructor(page) {
    this.page = page;
    this.title = page.getByTestId('registration-form-title');
    this.backToDashboardLink = page.getByTestId('registration-back-dashboard');
    this.usernameInput = page.getByTestId('registration-username');
    this.passwordInput = page.getByTestId('registration-password');
    this.roleSelect = page.getByTestId('registration-role');
    this.submitButton = page.getByTestId('registration-submit');
    this.successMessage = page.getByTestId('registration-success');
  }

  async fillForm(username, password, role) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.roleSelect.selectOption(role);
  }

  async submit() {
    await this.submitButton.click();
  }

  async goBackToDashboard() {
    await this.backToDashboardLink.click();
  }
}

module.exports = { RegistrationFormPage };
