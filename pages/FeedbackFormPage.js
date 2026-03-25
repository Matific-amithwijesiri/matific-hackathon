/**
 * Feedback form (form3.html) — locator strategies:
 * | Strategy      | Examples |
 * |---------------|----------|
 * | data-testid   | feedback-form-title, feedback-subject, feedback-body, feedback-rating, feedback-submit, feedback-success, feedback-back-dashboard |
 * | id            | feedbackForm, subject, feedback (textarea), rating, feedbackSubmit, feedbackSuccess — ids kept for app.js |
 * | name          | feedback (form), subject, feedback_body, rating |
 * | class         | app-page--feedback-form, app-input-feedback-rating |
 * | data-gtm-id   | feedback_field_subject, feedback_submit, … |
 * | data-page     | body[data-page="feedback-form"] |
 */
class FeedbackFormPage {
  constructor(page) {
    this.page = page;
    this.title = page.getByTestId('feedback-form-title');
    this.backToDashboardLink = page.getByTestId('feedback-back-dashboard');
    this.subjectInput = page.getByTestId('feedback-subject');
    this.feedbackInput = page.getByTestId('feedback-body');
    this.ratingSlider = page.getByTestId('feedback-rating');
    this.submitButton = page.getByTestId('feedback-submit');
    this.successMessage = page.getByTestId('feedback-success');
  }

  async fillForm(subject, feedback, rating) {
    await this.subjectInput.fill(subject);
    await this.feedbackInput.fill(feedback);
    await this.ratingSlider.fill(String(rating));
  }

  async submit() {
    await this.submitButton.click();
  }

  async goBackToDashboard() {
    await this.backToDashboardLink.click();
  }
}

module.exports = { FeedbackFormPage };
