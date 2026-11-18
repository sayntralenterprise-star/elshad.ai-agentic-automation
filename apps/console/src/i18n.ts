export const MESSAGES_EN = {
  'app.title': 'Elshad Platform',
  'login.title': 'Sign in to Elshad Platform',
  'login.subtitle': 'Unified AI Agent & Workflow Automation Control Plane',
  'login.email': 'Work email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.sso': 'Continue with SSO (OIDC)',
  'env.prod.banner':
    'Production environment active — changes affect live runs and require confirmation.',
  'home.title': 'Platform Overview',
  'home.onboarding': 'Getting Started Checklist',
  'settings.apikeys.title': 'API Keys',
  'governance.audit.title': 'Immutable Audit Log',
} as const;

export type MessageKey = keyof typeof MESSAGES_EN;

export function t(key: MessageKey): string {
  return MESSAGES_EN[key];
}
