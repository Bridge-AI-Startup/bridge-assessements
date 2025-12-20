export function createPageUrl(pageName: string) {
  // Routes are case-sensitive and match the PAGES keys exactly
  // So "Home" should map to "/Home", not "/home"
  return "/" + pageName;
}
