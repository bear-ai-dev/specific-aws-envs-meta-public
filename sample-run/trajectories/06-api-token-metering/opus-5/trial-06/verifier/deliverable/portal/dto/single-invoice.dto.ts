import { ReadInvoicesDto } from '../../invoice/dto/read-invoices.dto.js';
import { BasicResponseDTO } from '../../basicResponseDTO.js';

export class ReadSingleInvoiceResponse extends BasicResponseDTO {
    data: ReadInvoicesDto[];
}
