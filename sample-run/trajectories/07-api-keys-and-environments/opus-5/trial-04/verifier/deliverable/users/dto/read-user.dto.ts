import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { UserEntity } from '../entities/user.entity.js';
import { Environment } from './Environment.js';

export class ReadUserDTO {
    subject: string;
    /**
     * The environment the caller is working in. When it is left out, the environment the caller is
     * currently in is read from the configuration store.
     */
    environment?: Environment;
}
export class ReadResponseDTO extends BasicResponseDTO {
    public data: Array<UserEntity>;
}
