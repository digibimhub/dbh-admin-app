import { currentTotp, DEV_TOTP_SECRET } from './totp';

console.log(currentTotp(DEV_TOTP_SECRET));
