import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
    Inject,
    BadRequestException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { EnvironmentService, UsersService } from '../users/users.service.js';
import { Observable } from 'rxjs';

/*
 The below interceptor gets the request before it hits the controlelr, and attempts to assign an BusinessID to the user.businessID field. 
 Effectively associating the request with an account ID so that its data can be specifically accessed. 

 There are few things to note with the below interceptor. 

 Specifically, that there is a specical case for temporary accounts and businessIDs associated with those. These accounts effectively share a API credentials, in order to access the API, however they must pass in their businessID in the request.
 While this is less than ideal, it allows us to provide a temporary account for clients to try out portions of the application before buying a full version. 
**/
@Injectable()
export class BusinessIDInterceptor implements NestInterceptor {
    private readonly logger = new Logger(BusinessIDInterceptor.name);
    constructor(
        @Inject() private readonly userService: UsersService,
        @Inject() private readonly environmentService: EnvironmentService,
    ) {}
    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        // eslint-disable-next-line
        let { user, path, method, body, query, headers } = context.switchToHttp().getRequest();
        this.logger.log(
            ` API request info${
                typeof user === 'object' ? JSON.stringify(user) : user
            }, path: ${path}, method:${method} `,
        );
        // Exclude interceptor from the adding user path

        if (
            (method === 'POST' && path === '/users') ||
            (method === 'POST' && path === '/users/') ||
            (method === 'GET' && path === '/users/all') ||
            (method === 'PUT' && path === '/users/environment/admin') ||
            (method === 'GET' && path === '/users/login') ||
            (method === 'GET' && path === '/users/redirect') ||
            (method === 'POST' && path === '/usage/datastore') ||
            (method === 'GET' && path === '/kubernetes-manager/namespace') ||
            (method === 'GET' && path === '/kubernetes-manager/deployment') ||
            (method === 'POST' && path === '/kubernetes-manager/namespace') ||
            path === '/' ||
            (method === 'POST' && path === '/users/temp') ||
            (method === 'POST' && path === '/settings/free-trial') ||
            (method === 'GET' && path.startsWith('/portal/')) ||
            (method === 'PUT' && path === '/portal/customer') ||
            (method === 'PUT' && path === '/portal/customer/')
        ) {
            this.logger.debug('No business ID needed for the usermanagement paths');
            return next.handle();
        }
        try {
            const { findOne } = this.userService;

            if (user && user.sub) {
                const bound = findOne.bind(this.userService); // Need to bind the context explictly here, IDK why.
                let businessID;
                if (headers?.environment) {
                    let entities;
                    try {
                        entities = await this.environmentService.getEnvironmentsForUser(user.sub);
                    } catch (error) {
                        if (error instanceof NotFoundException) {
                            // The credential presented no longer signs in as an
                            // account this platform holds, so it is refused
                            // rather than resolved.
                            this.logger.warn(`No live account found for subject: ${user.sub}`);
                            throw new UnauthorizedException();
                        }
                        throw error;
                    }
                    const chosenEnvironment = headers.environment;
                    const result = entities.find((entity) => entity.environment === chosenEnvironment);
                    if (result?.businessID) {
                        this.logger.debug(
                            `found businessID: ${result?.businessID} for environment: ${chosenEnvironment} `,
                        );
                        businessID = result?.businessID;
                    } else {
                        this.logger.warn(`No BusinessID found for environment: ${chosenEnvironment}`);
                        throw new BadRequestException(`Invalid Environment chosen: ${chosenEnvironment}`);
                    }
                } else {
                    try {
                        const {
                            data: [{ businessID: lookedUpID }],
                        } = await bound({ subject: user.sub });
                        businessID = lookedUpID;
                    } catch (error) {
                        if (parseInt(error.status) !== 404) {
                            throw error;
                        }
                    }
                }
                this.logger.debug(`Logging BusinessID accessing MeteringCo ${businessID}`);
                if (businessID) {
                    user.businessID = businessID;
                } else {
                    this.logger.warn(
                        `No BusinessID found during request: ${
                            typeof user === 'object' ? JSON.stringify(user) : user
                        }, path: ${path}, method:${method}`,
                    );
                }
            } else {
                this.logger.warn(
                    `No user found during request: ${
                        typeof user === 'object' ? JSON.stringify(user) : user
                    }, path: ${path}, method:${method}`,
                );
            }

            if (user?.businessID) {
                body.businessID = user.businessID;
            }
        } catch (error) {
            console.log(error);
            throw error;
        }
        return next.handle();
    }
}
