import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { KeyEntity } from '../entities/key.entity.js';

export class ReadTokenResponseData {
    keyId: string;
    keyName: string;

    constructor({ clientId, clientName, permissions }: { clientId: string; clientName: string; permissions?: any }) {
        this.keyId = clientId;
        this.keyName = clientName;
        if (permissions) {
            this.keyName = permissions;
        }
    }
}

export class ReadTokenResponse extends BasicResponseDTO {
    data: Array<ReadTokenResponseData>;

    constructor(KeyEntities: KeyEntity[]) {
        super();
        this.message = 'Found Keys';
        this.data = KeyEntities.map((TokenEntity) => {
            const { clientId, clientName, permissions } = TokenEntity;
            return new ReadTokenResponseData({ clientId, clientName, permissions });
        });
    }
}
