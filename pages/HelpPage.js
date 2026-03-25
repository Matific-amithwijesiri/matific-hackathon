/**
 * Help Center (help.html) — locator strategies:
 * | data-testid | help-title, help-back-dashboard, help-intro, help-accordion, help-faq-*-body, help-footer-note |
 * | data-page   | body[data-page="help"] |
 * | class       | app-page--help, app-help-card |
 */
class HelpPage {
  constructor(page) {
    this.page = page;
    this.title = page.getByTestId('help-title');
    this.intro = page.getByTestId('help-intro');
    this.backToDashboardLink = page.getByTestId('help-back-dashboard');
    this.accordion = page.getByTestId('help-accordion');
    this.faqContactBody = page.getByTestId('help-faq-contact-body');
    this.faqRegistrationTrigger = page.getByTestId('help-faq-registration-trigger');
    this.faqRegistrationBody = page.getByTestId('help-faq-registration-body');
    this.faqFeedbackTrigger = page.getByTestId('help-faq-feedback-trigger');
    this.faqFeedbackBody = page.getByTestId('help-faq-feedback-body');
    this.footerNote = page.getByTestId('help-footer-note');
  }

  async goBackToDashboard() {
    await this.backToDashboardLink.click();
  }
}

module.exports = { HelpPage };
