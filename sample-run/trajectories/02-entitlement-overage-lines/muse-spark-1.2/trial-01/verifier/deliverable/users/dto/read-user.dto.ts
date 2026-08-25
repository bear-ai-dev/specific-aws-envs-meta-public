import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { UserEntity } from '../entities/user.entity.js';

export class ReadUserDTO {
    subject: string;
}
export class ReadResponseDTO extends BasicResponseDTO {
    public data: Array<UserEntity>;
}
