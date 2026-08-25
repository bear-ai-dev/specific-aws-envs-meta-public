import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

export class FileUploadDto {
    /**
     * The file to be commited to the server
     * Must be a PNG, cannot exceed 30 Mb
     */
    @ApiProperty()
    public file: Buffer;

    @ApiHideProperty()
    public businessID: string;
}
