// Public project settings. Privy App IDs are identifiers, never server secrets.
export const DEFAULT_PRIVY_APP_ID='cmwf7qwga005z0hk09mlze9xj';
export const PROJECT_ORIGINS=Object.freeze([
  'https://rayxento.xyz',
  'https://www.rayxento.xyz',
  'https://rapelaunch.xyz',
  'https://www.rapelaunch.xyz',
  'https://rapenew.vercel.app',
]);

export function privyAppId(value){
  return typeof value==='string'&&value.trim()?value.trim():DEFAULT_PRIVY_APP_ID;
}
