function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const error = document.getElementById('loginError');

  if (email === 'demo@example.com' && password === '123456') {
    localStorage.setItem('isLoggedIn', 'true');
    window.location.href = 'dashboard.html';
  } else {
    error.textContent = 'Invalid email or password';
    error.classList.remove('d-none');
  }
}

function ensureLoggedIn() {
  const protectedPages = ['dashboard.html', 'forms.html', 'form2.html', 'form3.html', 'help.html'];
  const currentPage = window.location.pathname.split('/').pop();
  if (protectedPages.includes(currentPage) && localStorage.getItem('isLoggedIn') !== 'true') {
    window.location.href = 'index.html';
  }
}

function logout() {
  localStorage.removeItem('isLoggedIn');
  window.location.href = 'index.html';
}

function showMessage(messageId, text) {
  const el = document.getElementById(messageId);
  if (el) {
    el.textContent = text;
    el.style.display = 'block';
  }
}

function submitContactForm(event) {
  event.preventDefault();
  showMessage('contactSuccess', 'Contact form submitted successfully');
}

function submitRegistrationForm(event) {
  event.preventDefault();
  showMessage('registrationSuccess', 'Registration form submitted successfully');
}

function submitFeedbackForm(event) {
  event.preventDefault();
  const rating = document.getElementById('rating').value;
  showMessage('feedbackSuccess', `Feedback form submitted successfully with rating ${rating}`);
}

window.addEventListener('DOMContentLoaded', ensureLoggedIn);