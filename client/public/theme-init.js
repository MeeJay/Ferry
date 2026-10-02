// Applies the saved theme before first paint (no light/dark flash).
try {
  var t = localStorage.getItem('ferry.theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
