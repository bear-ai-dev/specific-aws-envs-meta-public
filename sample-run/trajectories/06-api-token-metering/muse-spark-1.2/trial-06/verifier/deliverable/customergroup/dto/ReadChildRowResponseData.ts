import { ApiProperty } from '@nestjs/swagger';
import { BillParent } from '../entities/BillParent';

export class ReadChildRowResponseData {
    /**
     * The childId is the unique identifier for the child row
     * <br><br>
     * Example: `"9ffc73f3-eece-4a48-bfcd-c2c91153e97f"`
     */
    @ApiProperty({
        required: true,
        description:
            'The childId is the unique identifier for the child row <br><br> Example: `"9ffc73f3-eece-4a48-bfcd-c2c91153e97f"`',
        example: '9ffc73f3-eece-4a48-bfcd-c2c91153e97f',
    })
    public childId?: string;
    /**
     * The parentId is the unique identifier for the parent row
     * <br><br>
     * Example: `"e962aefe-6134-4f28-8967-a11cfe7f0bf2"`
     */
    @ApiProperty({
        required: true,
        description:
            'The parentId is the unique identifier for the parent row <br><br> Example: `"e962aefe-6134-4f28-8967-a11cfe7f0bf2"`',
        example: 'e962aefe-6134-4f28-8967-a11cfe7f0bf2',
    })
    public parentId?: string;

    /**
     * This determines if the parent should be billed for invoices of the child. Defaults to `separate`.
     * <br><br>
     * Example: `"aggregated"`
     */
    @ApiProperty({
        enum: BillParent,
        description:
            'This determines if the parent should be billed for invoices of the child. Defaults to `separate`. <br><br> Example: `"aggregated"`',
        example: BillParent.aggregated,
        default: BillParent.separate,
    })
    public billParent?: BillParent;
    constructor(entity) {
        if (entity) {
            this.childId = entity?.childId;
            this.parentId = entity?.parentId;
            this.billParent = entity?.billParent;
        }
    }
}
