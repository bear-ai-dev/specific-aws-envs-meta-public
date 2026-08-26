import { PickType } from '@nestjs/swagger';
import { UpdateSettingsDto } from './update-settings.dto.js';

/**
 * The fields of the business profile screen. <br>
 * All fields are optional, only the fields sent in are updated, everything else stored for the business is kept.
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
