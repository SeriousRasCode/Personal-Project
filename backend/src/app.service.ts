import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'HydroJimma API',
      version: '1.0.0',
      status: 'operational',
      documentation: '/docs',
    };
  }
}
