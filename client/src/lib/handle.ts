/** Usernames as shown: Obligate accounts drop their technical og_ prefix. */
export const displayHandle = (username: string) => username.replace(/^og_/, '');
