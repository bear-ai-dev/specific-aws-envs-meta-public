import { ApiProperty } from '@nestjs/swagger';

export class BasicResponseDTO {
    /**
     * A human readable message describing the operation
     * @example 'Found Customer'
     */
    @ApiProperty({
        name: 'message',
        description: 'A human readable message describing the outcome of the operation',
        example: 'This is a sample API message. The exact message may vary based on the API behavior',
    })
    public message: string;
}
