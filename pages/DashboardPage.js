/**
 * Dashboard (dashboard.html) — locator strategies:
 * | Strategy      | Examples |
 * |---------------|----------|
 * | data-testid   | dashboard-title, dashboard-subtitle, dashboard-nav-contact, dashboard-nav-help, logout-button, dashboard-card-*-desc |
 * | id            | dashboardTitle, logoutButton |
 * | class         | app-page--dashboard, app-nav-contact, app-btn-logout, nav-link-card |
 * | data-gtm-id   | dashboard_title, nav_contact_form, logout_click, … |
 * | data-page     | body[data-page="dashboard"] |
 */
class DashboardPage {
  constructor(page) {
    this.page = page;
    this.title = page.getByTestId('dashboard-title');
    this.subtitle = page.getByTestId('dashboard-subtitle');
    this.contactFormLink = page.getByTestId('dashboard-nav-contact');
    this.registrationFormLink = page.getByTestId('dashboard-nav-registration');
    this.feedbackFormLink = page.getByTestId('dashboard-nav-feedback');
    this.helpCenterLink = page.getByTestId('dashboard-nav-help');
    this.contactCardDescription = page.getByTestId('dashboard-card-contact-desc');
    this.registrationCardDescription = page.getByTestId('dashboard-card-registration-desc');
    this.feedbackCardDescription = page.getByTestId('dashboard-card-feedback-desc');
    this.helpCardDescription = page.getByTestId('dashboard-card-help-desc');
    this.logoutButton = page.getByTestId('logout-button');
  }

  async gotoContactForm() {
    await this.contactFormLink.click();
  }

  async gotoRegistrationForm() {
    await this.registrationFormLink.click();
  }

  async gotoFeedbackForm() {
    await this.feedbackFormLink.click();
  }

  async gotoHelpCenter() {
    await this.helpCenterLink.click();
  }

  async logout() {
    await this.logoutButton.click();
  }
}

module.exports = { DashboardPage };
