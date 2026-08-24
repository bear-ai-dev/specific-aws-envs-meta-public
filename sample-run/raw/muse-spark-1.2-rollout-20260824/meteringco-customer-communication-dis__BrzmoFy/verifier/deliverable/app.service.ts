import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
    getHealthCheck() {
        return { health: 'check' };
    }
}
