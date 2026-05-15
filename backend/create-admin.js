const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { AdminAuthService } = require('./dist/admin/admin-auth.service');
 
async function createAdmin() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const adminService = app.get(AdminAuthService);
 
  try {
    const admin = await adminService.createAdmin({
      username: 'admin',
      email: 'admin@bag1vbucks.local',
      password: 'admin123',
    });
 
    console.log('Admin created successfully!');
    console.log('Username: admin');
    console.log('Password: admin123');
    console.log('Email:', admin.email);
  } catch (error) {
    console.error('Error creating admin:', error.message);
  } finally {
    await app.close();
  }
}
 
createAdmin();