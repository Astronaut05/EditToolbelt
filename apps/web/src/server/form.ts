/** A text field from a submitted form: its string, or '' (a file or nothing becomes ''). */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
