import { PickType } from '@nestjs/swagger';
import { UpdateSettingsDto } from './update-settings.dto.js';

/**
 * The set of fields shown on the business profile screen.
 * <br><br>
 * Every field is optional, only the fields sent on the request are written, anything left out keeps
 * whatever the business already has stored.
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
    'redirectionUrl',
    'businessID',
    'subject',
] as const) {}
