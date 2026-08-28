// CSS Modules are resolved by Metro's web bundler, which TypeScript
// knows nothing about. Declares the shape so `tsc --noEmit` can run.
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
