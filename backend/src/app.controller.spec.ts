import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('returns API metadata', () => {
      expect(appController.getInfo()).toEqual({
        name: 'HydroJimma API',
        version: '1.0.0',
        status: 'operational',
        documentation: '/docs',
      });
    });
  });
});
