import { ExecutionContext } from '@nestjs/common';
import { productionBusinessID } from '../data/user';

const mockCanActivate = jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { businessID: productionBusinessID, sub: '12345' };
    return true;
});
export class MockJwtStrategy {
    canActivate;
    constructor() {
        this.canActivate = mockCanActivate;
    }
}
