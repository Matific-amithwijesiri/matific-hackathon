/**
 * Contact form (forms.html) — locator strategies:
 * | Strategy      | Examples |
 * |---------------|----------|
 * | data-testid   | contact-form-title, contact-name, contact-email, contact-message, contact-submit, contact-success, contact-back-dashboard |
 * | id            | contactForm, contactName, contactEmail, contactMessage, contactSubmit, contactSuccess |
 * | name          | contact (form), contact_name, contact_email, contact_message |
 * | class         | app-page--contact-form, app-form-contact, app-input-contact-name |
 * | data-gtm-id   | contact_field_name, contact_submit, contact_success_message, … |
 * | data-page     | body[data-page="contact-form"] |
 */
class ContactFormPage {
  constructor(page) {
    this.page = page;
    this.title = page.getByTestId('contact-form-title');
    this.backToDashboardLink = page.getByTestId('contact-back-dashboard');
    this.nameInput = page.getByTestId('contact-name');
    this.emailInput = page.getByTestId('contact-email');
    this.messageInput = page.getByTestId('contact-message');
    this.submitButton = page.getByTestId('contact-submit');
    this.successMessage = page.getByTestId('contact-success');
  }

  async fillForm(name, email, message) {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.messageInput.fill(message);
  }

  async submit() {
    await this.submitButton.click();
  }

  async goBackToDashboard() {
    await this.backToDashboardLink.click();
  }
}

module.exports = { ContactFormPage };
