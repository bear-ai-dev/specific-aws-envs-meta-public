import { PickType } from '@nestjs/swagger';
import { UpdateSettingsDto } from './update-settings.dto.js';

/**
 * The field set of the business profile screen. <br>
 * All fields are optional, only the fields sent in are written, everything else is left as it is
 * currently stored for the business.
 */
export class UpdateProfileDto extends PickType(UpdateSettingsDto, [
    'businessName',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'country',
    'postalCode',
    'supportEmail',
    'sendInvoiceEmail',
    'stripeAccountId',
    'redirectionUrl',
    'businessID',
    'subject',
] as const) {}
