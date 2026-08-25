import { PartialType } from '@nestjs/swagger';
import { CreateContractDto } from './createContract.dto';

export class UpdateContractDto extends PartialType(CreateContractDto) {
    constructor(createContractDto: CreateContractDto) {
        super(createContractDto);
    }
}
