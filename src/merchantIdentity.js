export function userDisplayName(user) {
  const accounts = user?.linkedAccounts || [];
  const named = [user?.google?.name, user?.twitter?.name, user?.name,
    ...accounts.filter(a => ['google_oauth','twitter_oauth','apple_oauth'].includes(a.type)).map(a => a.name)]
    .find(value => typeof value === 'string' && value.trim());
  if (named) return named.trim().slice(0, 100);
  const email = user?.email?.address || accounts.find(a => a.type === 'email')?.address;
  const username = email?.split('@')[0].split(/[.\-_]/)[0];
  return username ? username.replace(/^./u, c => c.toUpperCase()).slice(0,100) : 'Usuario';
}

export function merchantDisplayName(businessName, userName) {
  return businessName?.trim() || userName?.trim() || 'Usuario';
}
