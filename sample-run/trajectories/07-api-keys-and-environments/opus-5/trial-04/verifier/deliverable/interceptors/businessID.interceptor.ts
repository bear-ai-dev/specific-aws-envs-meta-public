import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
    Inject,
    BadRequestException,
} from '@nestjs/common';
import { EnvironmentService, UsersService } from '../users/users.service.js';
import { Environment } from '../users/dto/Environment.js';
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
            if (user && user.sub) {
                let businessID;
                const chosenEnvironment = headers?.environment;
                if (chosenEnvironment && !Object.values(Environment).includes(chosenEnvironment)) {
                    this.logger.warn(`Invalid Environment chosen: ${chosenEnvironment}`);
                    throw new BadRequestException(`Invalid Environment chosen: ${chosenEnvironment}`);
                }
                try {
                    // The environment the caller is in, or the one named on the request, decides
                    // which of the accounts of the tenant the request resolves to. The lookup only
                    // ever resolves an account which is still part of the configuration of the
                    // tenant, so a withdrawn credential is refused on the very next request.
                    const {
                        data: [{ businessID: lookedUpID }],
                    } = await this.userService.findOne({ subject: user.sub, environment: chosenEnvironment });
                    businessID = lookedUpID;
                } catch (error) {
                    if (parseInt(error.status) !== 404) {
                        throw error;
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

            if (user?.businessID && body) {
                body.businessID = user.businessID;
            }
        } catch (error) {
            console.log(error);
            throw error;
        }
        return next.handle();
    }
}
