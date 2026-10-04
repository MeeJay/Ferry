// Applies the theme before first paint (no flash). Dark is Ferry's signature
// theme: it is the default unless the visitor picked light.
try {
  if (localStorage.getItem('ferry.theme') !== 'light') document.documentElement.classList.add('dark');
} catch (e) { document.documentElement.classList.add('dark'); }
