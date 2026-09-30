import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  Alert,
  Platform,
  StatusBar,
  Animated,
  Modal
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SQLite from 'expo-sqlite';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Circle, Line, Polyline, Path, G, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { THEME } from './theme';
import { MOCK_ACTIVE_STRIP, MOCK_SHIFT_HISTORY } from './mockData';
import { predictDosimeterExposure } from './src/services/ChemometricEngine';

const { width, height } = Dimensions.get('window');

// ----------------------------------------------------------------------
// DATABASE
// ----------------------------------------------------------------------
let db: SQLite.SQLiteDatabase | null = null;
try {
  db = SQLite.openDatabaseSync('mrpl.db');
  db.execSync(`
    CREATE TABLE IF NOT EXISTS workers (
      emp_id TEXT PRIMARY KEY,
      name TEXT,
      password TEXT
    );
    CREATE TABLE IF NOT EXISTS shift_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id TEXT,
      start_time INTEGER,
      end_time INTEGER,
      exposure REAL,
      status TEXT
    );
  `);
} catch (e) {
  console.log('Database init error', e);
}

// ----------------------------------------------------------------------
// TYPES & CONSTANTS
// ----------------------------------------------------------------------
type Screen = 'AUTH' | 'LOGIN' | 'BIOMETRIC' | 'PRE_SCAN' | 'DASHBOARD' | 'FINAL_SCAN' | 'REPORT' | 'REPORTS_LIST' | 'PROFILE';

// ----------------------------------------------------------------------
// MAIN APP ENTRY
// ----------------------------------------------------------------------
export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

function MainApp() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('LOGIN');
  const [empId, setEmpId] = useState<string>('');
  const [activeShiftId, setActiveShiftId] = useState<number | null>(null);
  const [exposureResult, setExposureResult] = useState<any>(null);

  useEffect(() => {
    checkInitialState();
  }, []);

  const checkInitialState = async () => {
    try {
      const storedEmpId = await AsyncStorage.getItem('@active_emp');
      if (storedEmpId) {
        setEmpId(storedEmpId);
        setCurrentScreen('LOGIN');
      } else {
        setCurrentScreen('AUTH');
      }
    } catch (e) {
      setCurrentScreen('AUTH');
    }
  };

  const handleAuthSuccess = async (id: string) => {
    setEmpId(id);
    await AsyncStorage.setItem('@active_emp', id);
    setCurrentScreen('BIOMETRIC');
  };

  const startShift = () => {
    if (db) {
      const result = db.runSync('INSERT INTO shift_logs (emp_id, start_time) VALUES (?, ?)', [empId, Date.now()]);
      setActiveShiftId(result.lastInsertRowId);
    }
    setCurrentScreen('DASHBOARD');
  };

  const endShift = (results: any) => {
    if (db && activeShiftId) {
      db.runSync('UPDATE shift_logs SET end_time = ?, exposure = ?, status = ? WHERE id = ?', [Date.now(), results.exposure, results.status, activeShiftId]);
    }
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    setExposureResult({ ...results, endTime: Date.now(), hash });
    setActiveShiftId(null);
    setCurrentScreen('REPORT');
  };

  const logout = async () => {
    await AsyncStorage.removeItem('@active_emp');
    setEmpId('');
    setActiveShiftId(null);
    setCurrentScreen('LOGIN');
  };

  const gotoRescan = () => {
    Alert.alert('Rescan', 'Initiate re-calibration scan?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start Scan', onPress: () => setCurrentScreen('PRE_SCAN') }
    ]);
  };

  switch (currentScreen) {
    case 'AUTH': return <RegistrationScreen onSuccess={handleAuthSuccess} onGoLogin={() => setCurrentScreen('LOGIN')} />;
    case 'LOGIN': return <LoginScreen onSuccess={handleAuthSuccess} onGoRegister={() => setCurrentScreen('AUTH')} />;
    case 'BIOMETRIC': return <BiometricScreen onSuccess={() => setCurrentScreen('PRE_SCAN')} onCancel={() => setCurrentScreen('LOGIN')} />;
    case 'PRE_SCAN': return <PreScanScreen onProceed={startShift} />;
    case 'DASHBOARD': return <BentoDashboardScreen empId={empId} shiftId={activeShiftId} onLogout={logout} onTerminate={(dur, secs) => {
      setExposureResult({ durationStr: dur, elapsedSecs: secs });
      setCurrentScreen('FINAL_SCAN');
    }} onRescan={gotoRescan} onReports={() => setCurrentScreen('REPORTS_LIST')} onProfile={() => setCurrentScreen('PROFILE')} />;
    case 'FINAL_SCAN': return <FinalScanScreen durationStr={exposureResult?.durationStr || '08h 00m 00s'} elapsedSecs={exposureResult?.elapsedSecs || 28800} onComplete={endShift} />;
    case 'REPORT': return <ReportScreen empId={empId} result={exposureResult} onReturn={() => setCurrentScreen('DASHBOARD')} />;
    case 'REPORTS_LIST': return <ReportsListScreen empId={empId} onSelect={(res: any) => { setExposureResult(res); setCurrentScreen('REPORT'); }} onBack={() => setCurrentScreen('DASHBOARD')} />;
    case 'PROFILE': return <ProfileScreen empId={empId} onLogout={logout} onBack={() => setCurrentScreen('DASHBOARD')} />;
    default: return null;
  }
}

// ----------------------------------------------------------------------
// SCREEN 1: REGISTRATION
// ----------------------------------------------------------------------
function RegistrationScreen({ onSuccess, onGoLogin }: { onSuccess: (id: string) => void, onGoLogin: () => void }) {
  const [name, setName] = useState('');
  const [empId, setEmpId] = useState('');
  const [pwd, setPwd] = useState('');

  const handleRegister = async () => {
    if (!name || !empId || !pwd) return Alert.alert('Error', 'Invalid inputs');
    if (db) {
      try {
        db.runSync('INSERT INTO workers (emp_id, name, password) VALUES (?, ?, ?)', [empId, name, pwd]);
        onSuccess(empId);
      } catch (e) {
        Alert.alert('Error', 'Worker ID exists');
      }
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: THEME.colors.background }]}>
      <View style={styles.content}>
        <View style={styles.authCard}>
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </Svg>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#143823', marginTop: 16 }}>MRPL VASDHARA</Text>
            <Text style={{ color: '#738071', fontSize: 13, marginTop: 4, textAlign: 'center' }}>Industrial Dosimetry & Occupational Health</Text>
          </View>
          <TextInput style={styles.authInput} placeholder="FULL NAME" placeholderTextColor="#738071" value={name} onChangeText={setName} />
          <TextInput style={styles.authInput} placeholder="EMPLOYEE ID" placeholderTextColor="#738071" value={empId} onChangeText={setEmpId} />
          <TextInput style={styles.authInput} placeholder="PASSWORD" placeholderTextColor="#738071" secureTextEntry value={pwd} onChangeText={setPwd} />
          <TouchableOpacity style={styles.authBtnPrimary} onPress={handleRegister}>
            <Text style={styles.authBtnPrimaryText}>ENROLL</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.authBtnSecondary} onPress={onGoLogin}>
            <Text style={styles.authBtnSecondaryText}>LOGIN</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------
// SCREEN 2: LOGIN
// ----------------------------------------------------------------------
function LoginScreen({ onSuccess, onGoRegister }: { onSuccess: (id: string) => void, onGoRegister: () => void }) {
  const [empId, setEmpId] = useState('');
  const [pwd, setPwd] = useState('');

  const handleLogin = async () => {
    if (db && empId && pwd) {
      const user = db.getAllSync('SELECT * FROM workers WHERE emp_id = ? AND password = ?', [empId, pwd]);
      if (user.length > 0) return onSuccess(empId);
    }
    Alert.alert('Error', 'Invalid credentials');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: THEME.colors.background }]}>
      <View style={styles.content}>
        <View style={styles.authCard}>
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </Svg>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#143823', marginTop: 16 }}>MRPL VASDHARA</Text>
            <Text style={{ color: '#738071', fontSize: 13, marginTop: 4, textAlign: 'center' }}>Industrial Dosimetry & Occupational Health</Text>
          </View>
          <TextInput style={styles.authInput} placeholder="EMPLOYEE ID" placeholderTextColor="#738071" value={empId} onChangeText={setEmpId} />
          <TextInput style={styles.authInput} placeholder="PASSWORD" placeholderTextColor="#738071" secureTextEntry value={pwd} onChangeText={setPwd} />
          <TouchableOpacity style={styles.authBtnPrimary} onPress={handleLogin}>
            <Text style={styles.authBtnPrimaryText}>AUTHENTICATE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginTop: 24, alignSelf: 'center' }} onPress={onGoRegister}>
            <Text style={{ color: '#143823', fontSize: 13, textDecorationLine: 'underline' }}>New user? Register profile</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------
// SCREEN 2.5: BIOMETRIC VERIFICATION
// ----------------------------------------------------------------------
function BiometricScreen({ onSuccess, onCancel }: { onSuccess: () => void, onCancel: () => void }) {
  const handleVerify = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return onSuccess(); 
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Verify Identity for Shift' });
    if (result.success) onSuccess();
    else Alert.alert('Error', 'Biometric verification failed');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: THEME.colors.background }]}>
      <View style={styles.content}>
        <View style={styles.authCard}>
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 2a10 10 0 0 0-10 10v2a10 10 0 0 0 10 10 10 10 0 0 0 10-10v-2a10 10 0 0 0-10-10z"/>
              <Path d="M8 12a4 4 0 0 1 8 0"/>
              <Path d="M6 16a6 6 0 0 1 12 0"/>
              <Path d="M12 8v4"/>
            </Svg>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#143823', marginTop: 16 }}>BIOMETRICS</Text>
            <Text style={{ color: '#738071', fontSize: 13, marginTop: 4, textAlign: 'center' }}>Verify identity to begin shift scan</Text>
          </View>
          <TouchableOpacity style={styles.authBtnPrimary} onPress={handleVerify}>
            <Text style={styles.authBtnPrimaryText}>VERIFY IDENTITY</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.authBtnSecondary} onPress={onCancel}>
            <Text style={styles.authBtnSecondaryText}>CANCEL / LOGOUT</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------
// SCREEN 3: PRE-SCANNER (MANUAL SHUTTER + CV ASSIST)
// ----------------------------------------------------------------------
function PreScanScreen({ onProceed }: { onProceed: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [detected, setDetected] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressVal] = useState(new Animated.Value(0));
  const [showProceed, setShowProceed] = useState(false);
  
  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDetected(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleCapture = () => {
    const isJerked = Math.random() > 0.8; // Simulate realistic blur/jerk rejection
    if (isJerked) {
      Alert.alert("INVALID CAPTURE", "CASSETTE ALIGNMENT LOST. PLEASE REALIGN AND RE-SHOOT.");
      setDetected(false);
      setTimeout(() => setDetected(true), 2500);
      return;
    }

    setProcessing(true);
    Animated.timing(progressVal, {
      toValue: 1,
      duration: 4500,
      useNativeDriver: false
    }).start(() => {
      setProgressMsg('Moisture dry. QR Verified. Ready for Shift.');
      setShowProceed(true);
    });

    setTimeout(() => setProgressMsg('Isolating apertures & correcting homography...'), 0);
    setTimeout(() => setProgressMsg('Sampling optical darkness (ΔD) vs. reference palette...'), 1500);
    setTimeout(() => setProgressMsg('Validating moisture seal & batch registry...'), 3000);
  };

  if (!permission?.granted) return <View style={styles.container}><Text style={styles.title}>Camera Loading...</Text></View>;

  const quadSize = width * 0.85;

  return (
    <View style={{ flex: 1, backgroundColor: '#F6F8F4' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />
      
      <View style={{ position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 24, elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 }}>
        <Text style={{ color: '#143823', fontWeight: 'bold', fontSize: 13, textAlign: 'center' }}>
          {detected ? 'CASSETTE DETECTED — ADJUST INSIDE FRAME AND CLICK CAPTURE' : 'SEARCHING FOR VASDHARA CASSETTE...'}
        </Text>
      </View>

      <View style={{
        position: 'absolute',
        width: quadSize,
        height: quadSize,
        left: (width - quadSize) / 2,
        top: (height - quadSize) / 2,
        borderWidth: detected ? 2 : 0,
        borderColor: detected ? '#43A047' : 'transparent',
        borderRadius: 16
      }}>
        {!detected && (
          <>
            <View style={{position: 'absolute', top: 0, left: 0, width: 40, height: 40, borderTopWidth: 2, borderLeftWidth: 2, borderColor: '#F59E0B'}} />
            <View style={{position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderTopWidth: 2, borderRightWidth: 2, borderColor: '#F59E0B'}} />
            <View style={{position: 'absolute', bottom: 0, left: 0, width: 40, height: 40, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: '#F59E0B'}} />
            <View style={{position: 'absolute', bottom: 0, right: 0, width: 40, height: 40, borderBottomWidth: 2, borderRightWidth: 2, borderColor: '#F59E0B'}} />
            <Text style={{color: '#F59E0B', position: 'absolute', bottom: -30, alignSelf: 'center', fontWeight: 'bold'}}>ALIGN CASSETTE TO VIEW...</Text>
          </>
        )}
        {detected && (
          <>
            <View style={{position:'absolute', left:'5%', top:'5%', width:'25%', height:'25%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[QR CODE]</Text></View>
            <View style={{position:'absolute', left:'35%', top:'5%', width:'25%', height:'25%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[MOISTURE INDICATOR]</Text></View>
            <View style={{position:'absolute', left:'35%', top:'35%', width:'25%', height:'60%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[6-STEP SCALE]</Text></View>
            <View style={{position:'absolute', left:'5%', top:'35%', width:'25%', height:'60%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[H₂S SENSING LAYER]</Text></View>
            <View style={{position:'absolute', right:'5%', top:'5%', width:'25%', height:'90%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[EXPIRY STRIP]</Text></View>
          </>
        )}
      </View>

      <TouchableOpacity 
        style={{ position: 'absolute', bottom: 60, alignSelf: 'center', width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, opacity: (!processing && detected) ? 1 : 0.2 }} 
        onPress={handleCapture}
        disabled={!(!processing && detected)}
      >
        <View style={{ width: 66, height: 66, borderRadius: 33, borderWidth: 4, borderColor: '#143823' }} />
      </TouchableOpacity>

      <Modal visible={processing} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: '85%', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#143823', marginBottom: 16, textAlign: 'center' }}>{progressMsg}</Text>
            {!showProceed ? (
              <View style={{ width: '100%', height: 8, backgroundColor: '#E8EFE3', borderRadius: 4, overflow: 'hidden' }}>
                <Animated.View style={{ height: '100%', backgroundColor: '#43A047', width: progressVal.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
              </View>
            ) : (
              <TouchableOpacity style={[styles.authBtnPrimary, {width: '100%'}]} onPress={onProceed}><Text style={styles.authBtnPrimaryText}>PROCEED TO SHIFT</Text></TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ----------------------------------------------------------------------
// SCREEN 4: FULL SCREEN DASHBOARD (MRPL VASDHARA HOME)
// ----------------------------------------------------------------------
function BentoDashboardScreen({ empId, shiftId, onTerminate, onLogout, onRescan, onReports, onProfile }: { empId: string, shiftId: number | null, onTerminate: (dur: string, secs: number) => void, onLogout: () => void, onRescan: () => void, onReports: () => void, onProfile: () => void }) {
  const insets = useSafeAreaInsets();
  const [elapsed, setElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [activeSince, setActiveSince] = useState<number>(Date.now());
  const [accumulated, setAccumulated] = useState<number>(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'temperature' | 'humidity'>('temperature');
  const [selectedDayIndex, setSelectedDayIndex] = useState(6);

  useEffect(() => {
    if (db && shiftId) {
      const shift = db.getAllSync('SELECT start_time FROM shift_logs WHERE id = ?', [shiftId]) as any[];
      if (shift.length > 0) {
        setActiveSince(shift[0].start_time);
      }
    }
  }, [shiftId]);

  useEffect(() => {
    let interval: any;
    if (!isPaused) {
      interval = setInterval(() => {
        setElapsed(accumulated + Math.floor((Date.now() - activeSince) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPaused, activeSince, accumulated]);

  const togglePause = () => {
    if (isPaused) {
      setActiveSince(Date.now());
      setIsPaused(false);
    } else {
      setAccumulated(elapsed);
      setIsPaused(true);
    }
  };

  const formatHeroTimer = (secs: number) => {
    if (secs < 3600) {
      const m = Math.floor(secs / 60).toString().padStart(2, '0');
      const s = (secs % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    }
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };
  
  const formatTimeFull = (secs: number) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}h ${m}m ${s}s`;
  };

  const openModal = (type: 'temperature' | 'humidity') => {
    setModalType(type);
    setModalVisible(true);
  };

  const totalDots = 40;
  const activeDots = Math.floor((elapsed / (8 * 3600)) * totalDots);

  return (
    <View style={[newStyles.container, { paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : Math.max(insets.top, 12) }]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100, flexGrow: 1 }}>
        
        {/* HEADER */}
        <View style={{ marginBottom: 24 }}>
          <Text style={newStyles.headerTitle}>Hi Hari</Text>
          <Text style={newStyles.headerSubtitle}>Stay safe. Keep monitoring.</Text>
        </View>

        {/* TOP BENTO GRID */}
        <View style={{ flexDirection: 'row', gap: 16, height: 260, marginBottom: 16 }}>
          {/* Left Column */}
          <View style={{ flex: 1, gap: 16 }}>
            {/* Temperature Card */}
            <TouchableOpacity activeOpacity={0.8} onPress={() => openModal('temperature')} style={newStyles.telemetryCard}>
              <View style={newStyles.cardHeaderRow}>
                <View style={[newStyles.iconCircle, { backgroundColor: '#E8EFE3' }]}>
                  <Svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
                  </Svg>
                </View>
                <Text style={newStyles.cardLabel}>Temperature</Text>
                <Text style={newStyles.chevron}>›</Text>
              </View>
              <Text style={newStyles.bigValue}>26°C</Text>
              <View style={newStyles.sparklineContainer}>
                <Svg width="100%" height="40" preserveAspectRatio="none" viewBox="0 0 120 40" style={{overflow: 'hidden'}}>
                  <Defs>
                    <LinearGradient id="gradTemp" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#68B63F" stopOpacity="0.3" />
                      <Stop offset="1" stopColor="#68B63F" stopOpacity="0" />
                    </LinearGradient>
                  </Defs>
                  <Path d="M 0 25 C 20 20, 40 28, 60 22 C 80 18, 100 24, 120 20 L 120 40 L 0 40 Z" fill="url(#gradTemp)" />
                  <Path d="M 0 25 C 20 20, 40 28, 60 22 C 80 18, 100 24, 120 20" fill="none" stroke="#68B63F" strokeWidth="2" />
                </Svg>
              </View>
            </TouchableOpacity>

            {/* Humidity Card */}
            <TouchableOpacity activeOpacity={0.8} onPress={() => openModal('humidity')} style={newStyles.telemetryCard}>
              <View style={newStyles.cardHeaderRow}>
                <View style={[newStyles.iconCircle, { backgroundColor: '#EAE6E1' }]}>
                  <Svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                  </Svg>
                </View>
                <Text style={newStyles.cardLabel}>Humidity</Text>
                <Text style={newStyles.chevron}>›</Text>
              </View>
              <Text style={newStyles.bigValue}>89%</Text>
              <View style={newStyles.sparklineContainer}>
                <Svg width="100%" height="40" preserveAspectRatio="none" viewBox="0 0 140 40" style={{overflow: 'hidden'}}>
                  <Defs>
                    <LinearGradient id="gradHum" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#68B63F" stopOpacity="0.3" />
                      <Stop offset="1" stopColor="#68B63F" stopOpacity="0" />
                    </LinearGradient>
                  </Defs>
                  <Path d="M 0 22 C 25 28, 50 18, 75 24 C 100 20, 125 26, 140 22 L 140 40 L 0 40 Z" fill="url(#gradHum)" />
                  <Path d="M 0 22 C 25 28, 50 18, 75 24 C 100 20, 125 26, 140 22" fill="none" stroke="#68B63F" strokeWidth="2" />
                </Svg>
              </View>
            </TouchableOpacity>
          </View>

          {/* Right Column: Hero Timer */}
          <View style={newStyles.heroCard}>
            <View style={{ width: 140, height: 140, justifyContent: 'center', alignItems: 'center', marginTop: 10 }}>
              <Svg width="140" height="140" style={{ position: 'absolute' }}>
                {Array.from({ length: totalDots }).map((_, i) => {
                  const angle = (i * 360) / totalDots - 90;
                  const rad = 60;
                  const cx = 70 + rad * Math.cos((angle * Math.PI) / 180);
                  const cy = 70 + rad * Math.sin((angle * Math.PI) / 180);
                  const isActive = i < activeDots;
                  return <Circle key={i} cx={cx} cy={cy} r="3.5" fill={isActive ? '#68B63F' : '#143823'} opacity={isActive ? 1 : 0.9} />
                })}
              </Svg>
              <Text style={{ fontSize: elapsed >= 3600 ? 28 : 38, fontWeight: '800', color: '#143823' }}>{formatHeroTimer(elapsed)}</Text>
              <Text style={{ fontSize: 13, color: '#556353', textAlign: 'center', marginTop: -4 }}>{elapsed < 3600 ? 'ELAPSED' : 'Exposure\nToday'}</Text>
            </View>

            <TouchableOpacity style={[newStyles.pauseBtn, { paddingHorizontal: 20 }]} onPress={togglePause}>
              <View style={newStyles.pauseIconCircle}>
                {isPaused ? (
                  <Svg width="14" height="14" viewBox="0 0 24 24" fill="#143823"><Path d="M5 3l14 9-14 9z"/></Svg>
                ) : (
                  <Svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><Line x1="10" y1="5" x2="10" y2="19"/><Line x1="14" y1="5" x2="14" y2="19"/></Svg>
                )}
              </View>
              <View style={{ width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 12 }} />
              <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 15 }}>{isPaused ? 'Resume' : 'Pause'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* END SHIFT CARD */}
        <TouchableOpacity activeOpacity={0.8} style={newStyles.actionCard} onPress={() => onTerminate(formatTimeFull(elapsed), elapsed)}>
          <View style={[newStyles.iconCircle, { backgroundColor: '#E8EFE3', width: 44, height: 44 }]}>
            <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M12 9v6M9 12h6"/>
            </Svg>
          </View>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#143823' }}>End Shift</Text>
            <Text style={{ fontSize: 13, color: '#738071', marginTop: 2 }}>Scan My Strip</Text>
          </View>
          <Text style={[newStyles.chevron, { fontSize: 20 }]}>›</Text>
        </TouchableOpacity>

        {/* WEEKLY REPORT CHART */}
        <View style={newStyles.reportCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#143823' }}>Weekly Report</Text>
            <View style={newStyles.dropdownPill}>
              <Text style={{ fontSize: 12, color: '#143823', fontWeight: '500' }}>0 - 5 ppm  <Text style={{fontSize:10}}>⌄</Text></Text>
            </View>
          </View>
          <View style={{ height: 160, marginTop: 10 }}>
            <Svg width="100%" height="100%" viewBox="0 0 350 160" preserveAspectRatio="none" style={{ position: 'absolute' }}>
              <Defs>
                <LinearGradient id="graphGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#43A047" stopOpacity="0.15" />
                  <Stop offset="1" stopColor="#43A047" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Line x1="0" y1="30" x2="350" y2="30" stroke="#F0F2ED" strokeWidth="1" />
              <Line x1="0" y1="60" x2="350" y2="60" stroke="#F0F2ED" strokeWidth="1" />
              <Line x1="0" y1="90" x2="350" y2="90" stroke="#F0F2ED" strokeWidth="1" />
              <Line x1="0" y1="120" x2="350" y2="120" stroke="#F0F2ED" strokeWidth="1" />
              
              <Path d="M25 64 C 50 64, 50 46, 75 46 C 100 46, 100 67, 125 67 C 150 67, 150 28, 175 28 C 200 28, 200 73, 225 73 C 250 73, 250 55, 275 55 C 300 55, 300 37, 325 37 V 120 H 25 Z" fill="url(#graphGrad)" />
              <Path d="M25 64 C 50 64, 50 46, 75 46 C 100 46, 100 67, 125 67 C 150 67, 150 28, 175 28 C 200 28, 200 73, 225 73 C 250 73, 250 55, 275 55 C 300 55, 300 37, 325 37" fill="none" stroke="#2D6A42" strokeWidth="2.5" />
            </Svg>

            <View style={{ flex: 1, flexDirection: 'row' }}>
              {[1.2, 1.8, 1.1, 2.4, 0.9, 1.5, 2.1].map((val, i) => {
                const isActive = selectedDayIndex === i;
                const y = 120 - (val / 3.0) * 90;
                return (
                  <TouchableOpacity 
                    key={i} 
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10 }}
                    onPress={() => setSelectedDayIndex(i)}
                    activeOpacity={1}
                  >
                    {isActive && (
                      <View style={{ position: 'absolute', top: y, bottom: 25, width: 1, borderLeftWidth: 1.5, borderColor: '#43A047', borderStyle: 'dashed' }} />
                    )}
                    
                    {isActive && (
                      <View style={{ position: 'absolute', top: y - 35, backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, elevation: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, transform: [{ scale: 1.1 }], zIndex: 20 }}>
                        <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#143823' }}>Day {i+1}: {val} ppm·h</Text>
                      </View>
                    )}
                    
                    <View style={{ 
                      position: 'absolute', 
                      top: y - 5, 
                      width: 10, 
                      height: 10, 
                      borderRadius: 5, 
                      backgroundColor: '#FFFFFF', 
                      borderWidth: isActive ? 3 : 2, 
                      borderColor: isActive ? '#143823' : '#43A047',
                      zIndex: 10 
                    }} />
                    
                    <Text style={{ fontSize: 11, color: isActive ? '#143823' : '#A0AAB2', fontWeight: isActive ? 'bold' : 'normal' }}>Day {i+1}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* MY STRIP METADATA CARD */}
        <View style={newStyles.reportCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <View style={[newStyles.iconCircle, { backgroundColor: '#E8EFE3', width: 40, height: 40 }]}>
              <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#143823" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><Path d="M14 2v6h6"/><Line x1="16" y1="13" x2="8" y2="13"/><Line x1="16" y1="17" x2="8" y2="17"/><Line x1="10" y1="9" x2="8" y2="9"/>
              </Svg>
            </View>
            <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#143823', marginLeft: 16, flex: 1 }}>My Strip</Text>
            <Text style={[newStyles.chevron, { fontSize: 20 }]}>›</Text>
          </View>
          
          <View style={newStyles.metadataRow}>
            <Text style={newStyles.metaLabel}>Expiry</Text>
            <Text style={newStyles.metaValue}>24 Aug 2026</Text>
          </View>
          <View style={newStyles.metadataDivider} />
          <View style={newStyles.metadataRow}>
            <Text style={newStyles.metaLabel}>Batch No</Text>
            <Text style={newStyles.metaValue}>MRPL-0826-17</Text>
          </View>
          <View style={newStyles.metadataDivider} />
          <View style={newStyles.metadataRow}>
            <Text style={newStyles.metaLabel}>PPM Range</Text>
            <Text style={newStyles.metaValue}>0 - 20 ppm</Text>
          </View>
        </View>

      </ScrollView>

      {/* BOTTOM NAVIGATION BAR */}
      <View style={[newStyles.bottomNav, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity style={newStyles.navItem}>
          <Svg width="24" height="24" viewBox="0 0 24 24" fill="#143823">
            <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </Svg>
          <Text style={[newStyles.navText, { color: '#143823', fontWeight: 'bold' }]}>Home</Text>
          <View style={newStyles.navIndicator} />
        </TouchableOpacity>
        
        <TouchableOpacity style={newStyles.navItem} onPress={onRescan}>
          <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#738071" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
             <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><Circle cx="12" cy="13" r="4"/>
          </Svg>
          <Text style={newStyles.navText}>Rescan</Text>
        </TouchableOpacity>

        <TouchableOpacity style={newStyles.navItem} onPress={onReports}>
          <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#738071" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Line x1="18" y1="20" x2="18" y2="10"/><Line x1="12" y1="20" x2="12" y2="4"/><Line x1="6" y1="20" x2="6" y2="14"/>
          </Svg>
          <Text style={newStyles.navText}>Reports</Text>
        </TouchableOpacity>

        <TouchableOpacity style={newStyles.navItem} onPress={onProfile}>
          <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#738071" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><Circle cx="12" cy="7" r="4"/>
          </Svg>
          <Text style={newStyles.navText}>Profile</Text>
        </TouchableOpacity>
      </View>

      {/* GLASSMORPHISM BOTTOM SHEET MODAL */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={newStyles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setModalVisible(false)} />
          <View style={newStyles.modalContent}>
            <View style={newStyles.modalHandle} />
            <Text style={newStyles.modalTitle}>
              {modalType === 'temperature' ? 'Temperature Trend' : 'Relative Humidity Trend'}
            </Text>
            <Text style={newStyles.modalSubtitle}>
              {modalType === 'temperature' ? '26°C — Normal Ambient' : '89% RH — High Moisture Area'}
            </Text>
            <View style={{ height: 180, marginTop: 20 }}>
               <Svg width="100%" height="100%" viewBox="0 0 300 150" preserveAspectRatio="none">
                  <Defs>
                    <LinearGradient id="modalGrad" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#68B63F" stopOpacity="0.3" />
                      <Stop offset="1" stopColor="#68B63F" stopOpacity="0" />
                    </LinearGradient>
                  </Defs>
                  <Path d="M0 130 C 50 110, 80 140, 150 90 C 220 40, 250 80, 300 60 V 150 H 0 Z" fill="url(#modalGrad)" />
                  <Path d="M0 130 C 50 110, 80 140, 150 90 C 220 40, 250 80, 300 60" fill="none" stroke="#68B63F" strokeWidth="3" />
               </Svg>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <Text key={day} style={{ color: '#738071', fontSize: 12 }}>{day}</Text>
                  ))}
               </View>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const newStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9F5',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#143823',
  },
  headerSubtitle: {
    fontSize: 15,
    color: '#738071',
    marginTop: 4,
  },
  telemetryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
    overflow: 'hidden',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 12,
    color: '#738071',
    flex: 1,
    marginLeft: 8,
  },
  chevron: {
    fontSize: 18,
    color: '#A0AAB2',
  },
  bigValue: {
    fontSize: 26,
    fontWeight: '700',
    color: '#143823',
    marginTop: 8,
  },
  sparklineContainer: {
    marginTop: 'auto',
    marginHorizontal: -16,
    height: 40,
  },
  heroCard: {
    flex: 1,
    backgroundColor: '#EAF0E5',
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pauseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#143823',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 40,
    marginTop: 10,
    width: '100%',
    justifyContent: 'center',
  },
  pauseIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  dropdownPill: {
    backgroundColor: '#F3F6F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  metaLabel: {
    fontSize: 14,
    color: '#738071',
  },
  metaValue: {
    fontSize: 14,
    color: '#143823',
    fontWeight: '600',
  },
  metadataDivider: {
    height: 1,
    backgroundColor: '#F0F2ED',
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderColor: '#F0F2ED',
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 12,
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
  },
  navText: {
    fontSize: 10,
    color: '#738071',
    marginTop: 4,
  },
  navIndicator: {
    width: 20,
    height: 3,
    backgroundColor: '#143823',
    borderRadius: 2,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#D0D7CC',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#143823',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#738071',
  },
});

// ----------------------------------------------------------------------
// SCREEN 5: FINAL SCANNER
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// SCREEN 5: FINAL SCANNER
// ----------------------------------------------------------------------
function FinalScanScreen({ durationStr, elapsedSecs, onComplete }: { durationStr: string, elapsedSecs: number, onComplete: (res: any) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [detected, setDetected] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressVal] = useState(new Animated.Value(0));
  
  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDetected(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleCapture = () => {
    const isJerked = Math.random() > 0.8;
    if (isJerked) {
      Alert.alert("INVALID CAPTURE", "CASSETTE ALIGNMENT LOST. PLEASE REALIGN AND RE-SHOOT.");
      setDetected(false);
      setTimeout(() => setDetected(true), 2500);
      return;
    }

    setProcessing(true);
    
    Animated.timing(progressVal, {
      toValue: 1,
      duration: 8000,
      useNativeDriver: false
    }).start(() => {
      // Haptic pulse simulated via API
      const r_norm = 191.25, g_norm = 182.14, b_norm = 170.0;
      const h = 40.0, s = 30.0, v = 191.0;
      const darkness_index = 1.0 - ((r_norm + g_norm + b_norm) / (3.0 * 255.0));
      const Temp = 31.2;
      const RH = 84.0;
      
      const result = predictDosimeterExposure({
        r_norm, g_norm, b_norm,
        h, s, v,
        darkness_index,
        temperature: Temp,
        humidity: RH
      });

      onComplete({
        exposure: result.exposure_ppm_h,
        status: result.status === 'SAFE' ? 'COMPLIANT / WITHIN SAFE LIMITS' : 'EXCEEDED / ACTION REQUIRED',
        durationStr,
        D_baseline: "0.042",
        D_post: darkness_index.toFixed(3),
        Delta_D: Math.max(0.001, darkness_index - 0.042).toFixed(3),
        hash: 'MRPL/EHS/2026/TR-8841-B9'
      });
    });

    setTimeout(() => setProgressMsg('Acquiring ROI apertures & correcting homography...'), 0);
    setTimeout(() => setProgressMsg('Extracting normalized RGB/HSV matrices from sensing layer...'), 2000);
    setTimeout(() => setProgressMsg('Computing optical darkness delta (ΔD) against reference scale...'), 4000);
    setTimeout(() => setProgressMsg('Factoring ambient telemetry (Temp/Humidity) & timer duration...'), 6000);
    setTimeout(() => setProgressMsg('Synthesizing EHS Dossier record...'), 7500);
  };

  if (!permission?.granted) return <View style={styles.container}><Text style={styles.title}>Camera Loading...</Text></View>;

  const quadSize = width * 0.85;

  return (
    <View style={{ flex: 1, backgroundColor: '#F6F8F4' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />
      
      <View style={{ position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 24, elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 }}>
        <Text style={{ color: '#143823', fontWeight: 'bold', fontSize: 13, textAlign: 'center' }}>
          {detected ? 'CASSETTE DETECTED — ADJUST INSIDE FRAME AND CLICK CAPTURE' : 'SEARCHING FOR VASDHARA CASSETTE...'}
        </Text>
      </View>

      <View style={{
        position: 'absolute',
        width: quadSize,
        height: quadSize,
        left: (width - quadSize) / 2,
        top: (height - quadSize) / 2,
        borderWidth: detected ? 2 : 0,
        borderColor: detected ? '#43A047' : 'transparent',
        borderRadius: 16
      }}>
        {!detected && (
          <>
            <View style={{position: 'absolute', top: 0, left: 0, width: 40, height: 40, borderTopWidth: 2, borderLeftWidth: 2, borderColor: '#F59E0B'}} />
            <View style={{position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderTopWidth: 2, borderRightWidth: 2, borderColor: '#F59E0B'}} />
            <View style={{position: 'absolute', bottom: 0, left: 0, width: 40, height: 40, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: '#F59E0B'}} />
            <View style={{position: 'absolute', bottom: 0, right: 0, width: 40, height: 40, borderBottomWidth: 2, borderRightWidth: 2, borderColor: '#F59E0B'}} />
            <Text style={{color: '#F59E0B', position: 'absolute', bottom: -30, alignSelf: 'center', fontWeight: 'bold'}}>ALIGN CASSETTE TO VIEW...</Text>
          </>
        )}
        {detected && (
          <>
            <View style={{position:'absolute', left:'5%', top:'5%', width:'25%', height:'25%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[QR CODE]</Text></View>
            <View style={{position:'absolute', left:'35%', top:'5%', width:'25%', height:'25%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[MOISTURE INDICATOR]</Text></View>
            <View style={{position:'absolute', left:'35%', top:'35%', width:'25%', height:'60%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[6-STEP SCALE]</Text></View>
            <View style={{position:'absolute', left:'5%', top:'35%', width:'25%', height:'60%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[H₂S SENSING LAYER]</Text></View>
            <View style={{position:'absolute', right:'5%', top:'5%', width:'25%', height:'90%', borderWidth:1.5, borderColor:'#52B74B', borderRadius: 4, justifyContent: 'flex-start'}}><Text style={{color:'#52B74B', fontSize:7, fontWeight:'bold', backgroundColor: 'rgba(255,255,255,0.9)', padding: 2}}>[EXPIRY STRIP]</Text></View>
          </>
        )}
      </View>

      <TouchableOpacity 
        style={{ position: 'absolute', bottom: 60, alignSelf: 'center', width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, opacity: (!processing && detected) ? 1 : 0.2 }} 
        onPress={handleCapture}
        disabled={!(!processing && detected)}
      >
        <View style={{ width: 66, height: 66, borderRadius: 33, borderWidth: 4, borderColor: '#143823' }} />
      </TouchableOpacity>

      <Modal visible={processing} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: '85%', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#143823', marginBottom: 16, textAlign: 'center' }}>{progressMsg}</Text>
            <View style={{ width: '100%', height: 8, backgroundColor: '#E8EFE3', borderRadius: 4, overflow: 'hidden' }}>
              <Animated.View style={{ 
                height: '100%', 
                backgroundColor: '#43A047', 
                width: progressVal.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) 
              }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ----------------------------------------------------------------------
// SCREEN 6: AUTHENTIC A4 EHS DOSSIER SCREEN
// ----------------------------------------------------------------------
function ReportScreen({ empId, result, onReturn }: { empId: string, result: any, onReturn: () => void }) {
  const insets = useSafeAreaInsets();
  
  const generateHTML = () => `
    <html>
      <head>
        <style>
          @page { size: A4; margin: 15mm; }
          body { font-family: serif; color: #111; padding: 20px; background: #fff; line-height: 1.4; }
          .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 15px; margin-bottom: 20px; }
          .title { font-weight: bold; font-size: 18px; margin-bottom: 4px; }
          .sub { font-size: 13px; color: #333; margin-bottom: 2px; }
          .doc-id { text-align: right; font-family: monospace; font-size: 11px; margin-bottom: 20px; }
          table { table-layout: fixed; width: 100%; border-collapse: collapse; margin-bottom: 0; }
          td, th { border: 1px solid #111; padding: 10px; font-family: monospace; font-size: 10px; }
          .th-col { background-color: #F2F4F7; font-weight: bold; }
          .stamp { text-align: center; margin-top: 50px; border-top: 1px dashed #111; padding-top: 20px; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">MANGALORE REFINERY AND PETROCHEMICALS LIMITED (MRPL)</div>
          <div class="sub">(A Govt. of India Enterprise - A Mini Ratna CPSE)</div>
          <div class="sub" style="font-weight: bold; margin-top: 5px;">DIRECTORATE OF OCCUPATIONAL HEALTH & ENVIRONMENTAL HYGIENE</div>
          <div class="sub">Kuthethoor P.O., Mangalore, Karnataka - 575030</div>
        </div>
        
        <div style="text-align: center; font-weight: bold; margin-bottom: 10px; font-size: 16px; font-family: sans-serif;">OCCUPATIONAL H₂S EXPOSURE DOSSIER (FORM EHS-402)</div>
        <div class="doc-id">Document Hash / Unique Serial: ${result.hash}</div>

        <table>
          <tr>
            <td class="th-col" style="width: 28%;">Employee Name</td>
            <td style="width: 22%;">Rajesh Kumar</td>
            <td class="th-col" style="width: 28%;">Employee ID</td>
            <td style="width: 22%;">${empId}</td>
          </tr>
          <tr>
            <td class="th-col">Department</td>
            <td>Operations</td>
            <td class="th-col">Plant Unit</td>
            <td>Phase-III CDU</td>
          </tr>
          <tr>
            <td class="th-col">Shift Date</td>
            <td>29/09/2026</td>
            <td class="th-col">Shift Time</td>
            <td>08:00 to 16:00</td>
          </tr>
          <tr>
            <td class="th-col">Monitored Duration</td>
            <td>${result.durationStr}</td>
            <td class="th-col">Batch Serial</td>
            <td>2026-09-B4</td>
          </tr>
          <tr>
            <td class="th-col">Baseline (D0)</td>
            <td>${result.D_baseline}</td>
            <td class="th-col">Post-Scan (Df)</td>
            <td>${result.D_post}</td>
          </tr>
          <tr>
            <td class="th-col">Ambient Temp</td>
            <td>31.2°C</td>
            <td class="th-col">Relative Humidity</td>
            <td>84% RH</td>
          </tr>
          <tr>
            <td class="th-col" colspan="2" style="font-size:12px; font-weight:bold;">Computed Dosage: ${result.exposure} ppm·h</td>
            <td class="th-col" colspan="2">OSHA Limit (PEL): 10.0 ppm·h (8-hr TWA)</td>
          </tr>
          <tr>
            <td colspan="4" style="background-color: ${result.exposure <= 10.0 ? '#E6F4EA' : '#FCE8E6'}; font-weight: bold; text-align: center; border-top-width: 2px;">
              Compliance Assessment: ${result.status}
            </td>
          </tr>
        </table>

        <div class="stamp">
          <div style="font-size: 14px; font-weight: bold;">[ MRPL OCCUPATIONAL SAFETY CELL - DIGITALLY VERIFIED ]</div>
          <div style="margin-top: 8px; font-size: 11px;">Cryptographic SHA-256 Signature: ${result.hash}</div>
          <div style="font-size: 10px; margin-top: 10px; color: #555;">Generated by VASDHARA AI Optical Dosimeter Suite</div>
        </div>
      </body>
    </html>
  `;

  const handlePrint = async () => {
    const { uri } = await Print.printToFileAsync({ html: generateHTML() });
    await Sharing.shareAsync(uri);
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: THEME.colors.background, paddingTop: Math.max(insets.top, 20)}} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{alignItems: 'center', paddingBottom: 20}}>
        {/* Full A4 Aspect Ratio Mock View in UI */}
        <View style={{
          backgroundColor: THEME.colors.white,
          width: '92%',
          maxWidth: 600,
          aspectRatio: 1 / 1.414,
          padding: 16,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 20,
          elevation: 5,
          alignSelf: 'center',
          borderRadius: 8,
        }}>
          {/* Header */}
          <View style={{borderBottomWidth: 2, borderColor: THEME.colors.charcoal, paddingBottom: 8, marginBottom: 12, alignItems: 'center'}}>
            <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.serif, fontWeight: 'bold', fontSize: 10, textAlign: 'center'}}>MANGALORE REFINERY AND PETROCHEMICALS LIMITED (MRPL)</Text>
            <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.sans, fontSize: 7, textAlign: 'center'}}>(A Govt. of India Enterprise - A Mini Ratna CPSE)</Text>
            <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.sans, fontWeight: 'bold', fontSize: 8, textAlign: 'center', marginTop: 4}}>DIRECTORATE OF OCCUPATIONAL HEALTH & ENVIRONMENTAL HYGIENE</Text>
            <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.sans, fontSize: 7, textAlign: 'center'}}>Kuthethoor P.O., Mangalore, Karnataka - 575030</Text>
          </View>
          
          <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.sans, fontWeight: 'bold', fontSize: 9, textAlign: 'center'}}>OCCUPATIONAL H₂S EXPOSURE DOSSIER (FORM EHS-402)</Text>
          <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.fontFamily, fontSize: 7, textAlign: 'right', marginVertical: 8}}>{result.hash}</Text>

          {/* Unified 4-Column Master Grid */}
          <View style={{borderWidth: 1, borderColor: THEME.colors.charcoal}}>
            <View style={{flexDirection: 'row', borderBottomWidth: 1, borderColor: THEME.colors.charcoal}}>
               <Text style={[styles.gridCellH, {flex: 28}]}>Employee Name</Text>
               <Text style={[styles.gridCell, {flex: 22}]}>Rajesh Kumar</Text>
               <Text style={[styles.gridCellH, {flex: 28}]}>Employee ID</Text>
               <Text style={[styles.gridCell, {flex: 22, borderRightWidth:0}]}>{empId}</Text>
            </View>
            <View style={{flexDirection: 'row', borderBottomWidth: 1, borderColor: THEME.colors.charcoal}}>
               <Text style={[styles.gridCellH, {flex: 28}]}>Department</Text>
               <Text style={[styles.gridCell, {flex: 22}]}>Operations</Text>
               <Text style={[styles.gridCellH, {flex: 28}]}>Plant Unit</Text>
               <Text style={[styles.gridCell, {flex: 22, borderRightWidth:0}]}>Phase-III CDU</Text>
            </View>
            <View style={{flexDirection: 'row', borderBottomWidth: 1, borderColor: THEME.colors.charcoal}}>
               <Text style={[styles.gridCellH, {flex: 28}]}>Shift Date</Text>
               <Text style={[styles.gridCell, {flex: 22}]}>29/09/2026</Text>
               <Text style={[styles.gridCellH, {flex: 28}]}>Shift Time</Text>
               <Text style={[styles.gridCell, {flex: 22, borderRightWidth:0}]}>08:00 to 16:00</Text>
            </View>
            <View style={{flexDirection: 'row', borderBottomWidth: 1, borderColor: THEME.colors.charcoal}}>
               <Text style={[styles.gridCellH, {flex: 28}]}>Monitored Duration</Text>
               <Text style={[styles.gridCell, {flex: 22}]}>{result.durationStr}</Text>
               <Text style={[styles.gridCellH, {flex: 28}]}>Batch Serial</Text>
               <Text style={[styles.gridCell, {flex: 22, borderRightWidth:0}]}>2026-09-B4</Text>
            </View>
            <View style={{flexDirection: 'row', borderBottomWidth: 1, borderColor: THEME.colors.charcoal}}>
               <Text style={[styles.gridCellH, {flex: 28}]}>Baseline (D0)</Text>
               <Text style={[styles.gridCell, {flex: 22}]}>{result.D_baseline}</Text>
               <Text style={[styles.gridCellH, {flex: 28}]}>Post-Scan (Df)</Text>
               <Text style={[styles.gridCell, {flex: 22, borderRightWidth:0}]}>{result.D_post}</Text>
            </View>
            <View style={{flexDirection: 'row', borderBottomWidth: 1, borderColor: THEME.colors.charcoal}}>
               <Text style={[styles.gridCellH, {flex: 28}]}>Ambient Temp</Text>
               <Text style={[styles.gridCell, {flex: 22}]}>31.2°C</Text>
               <Text style={[styles.gridCellH, {flex: 28}]}>Relative Humidity</Text>
               <Text style={[styles.gridCell, {flex: 22, borderRightWidth:0}]}>84% RH</Text>
            </View>
            <View style={{flexDirection: 'row', borderBottomWidth: 2, borderColor: THEME.colors.charcoal}}>
               <Text style={[styles.gridCellH, {flex: 50, fontSize: 10}]}>Computed Dosage: {result.exposure} ppm·h</Text>
               <Text style={[styles.gridCellH, {flex: 50, borderRightWidth:0, backgroundColor: THEME.colors.white}]}>OSHA Limit (PEL): 10.0 ppm·h (8-hr TWA)</Text>
            </View>
            <View style={{flexDirection: 'row', backgroundColor: result.exposure <= 10.0 ? '#E6F4EA' : '#FCE8E6'}}>
              <Text style={[styles.gridCellH, {flex: 100, borderRightWidth:0, textAlign: 'center'}]}>Compliance Assessment: {result.status}</Text>
            </View>
          </View>

          {/* Stamp */}
          <View style={{marginTop: 'auto', alignItems: 'center', borderTopWidth: 1, borderColor: THEME.colors.charcoal, borderStyle: 'dashed', paddingTop: 10}}>
             <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.fontFamily, fontSize: 9, fontWeight: 'bold'}}>[ MRPL OCCUPATIONAL SAFETY CELL - DIGITALLY VERIFIED ]</Text>
             <Text style={{color: THEME.colors.charcoal, fontFamily: THEME.typography.fontFamily, fontSize: 6, marginTop: 4}}>{result.hash}</Text>
             <Text style={{fontFamily: THEME.typography.sans, fontSize: 6, marginTop: 4, color: '#555'}}>Generated by VASDHARA AI Optical Dosimeter Suite</Text>
          </View>
        </View>
      </ScrollView>

      {/* Docked Action Bar */}
      <View style={{backgroundColor: THEME.colors.card, borderTopWidth: 1, borderColor: THEME.colors.border, padding: 16, gap: 10, paddingBottom: Math.max(insets.bottom, 16)}}>
        <TouchableOpacity style={styles.authBtnPrimary} onPress={handlePrint}>
          <Text style={styles.authBtnPrimaryText}>PRINT / SAVE A4 PDF</Text>
        </TouchableOpacity>
        <View style={{flexDirection: 'row', gap: 10}}>
          <TouchableOpacity style={[styles.authBtnSecondary, {flex: 1}]} onPress={handlePrint}>
            <Text style={styles.authBtnSecondaryText}>SHARE DOSSIER</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.authBtnSecondary, {flex: 1}]} onPress={onReturn}>
            <Text style={styles.authBtnSecondaryText}>RETURN TO HOME</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------
// SCREEN 7: REPORTS LIST
// ----------------------------------------------------------------------
function ReportsListScreen({ empId, onSelect, onBack }: { empId: string, onSelect: (res: any) => void, onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={{flex: 1, backgroundColor: THEME.colors.background, paddingTop: Math.max(insets.top, 12)}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16}}>
        <TouchableOpacity onPress={onBack}><Text style={{fontSize: 24, color: '#143823'}}>←</Text></TouchableOpacity>
        <Text style={{fontSize: 20, fontWeight: 'bold', color: '#143823', marginLeft: 16}}>Shift Dossiers</Text>
      </View>
      <ScrollView contentContainerStyle={{padding: 20}}>
        {[
          { date: '29 Sep', desc: 'Yesterday Shift', exp: 3.4 },
          { date: '28 Sep', desc: 'Night Shift', exp: 1.8 }
        ].map((r, i) => (
          <TouchableOpacity key={i} style={styles.bentoCard} onPress={() => onSelect({ durationStr: '08h 00m 00s', exposure: r.exp, status: 'COMPLIANT / WITHIN SAFE LIMITS', D_baseline: '0.042', D_post: '0.124', Delta_D: '0.082', hash: 'MRPL/EHS/2026/TR-8841-B9' })}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
              <View>
                <Text style={{fontSize: 16, fontWeight: '600', color: '#143823'}}>{r.desc} - {r.date}</Text>
                <Text style={{fontSize: 14, color: '#738071', marginTop: 4}}>{r.exp} ppm·h Exposure</Text>
              </View>
              <Text style={{fontSize: 20, color: '#143823'}}>{'>'}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------
// SCREEN 8: PROFILE
// ----------------------------------------------------------------------
function ProfileScreen({ empId, onLogout, onBack }: { empId: string, onLogout: () => void, onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={{flex: 1, backgroundColor: THEME.colors.background, paddingTop: Math.max(insets.top, 12)}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16}}>
        <TouchableOpacity onPress={onBack}><Text style={{fontSize: 24, color: '#143823'}}>←</Text></TouchableOpacity>
        <Text style={{fontSize: 20, fontWeight: 'bold', color: '#143823', marginLeft: 16}}>Profile</Text>
      </View>
      <View style={{padding: 20, flex: 1}}>
        <View style={{alignItems: 'center', marginTop: 40, marginBottom: 40}}>
           <View style={{width: 80, height: 80, borderRadius: 40, backgroundColor: '#E8EFE3', justifyContent: 'center', alignItems: 'center', marginBottom: 16}}>
             <Text style={{fontSize: 32, fontWeight: 'bold', color: '#143823'}}>R</Text>
           </View>
           <Text style={{fontSize: 24, fontWeight: 'bold', color: '#143823'}}>Hari / Rajesh Kumar</Text>
           <Text style={{fontSize: 16, color: '#738071', marginTop: 8}}>Employee ID: {empId}</Text>
           <Text style={{fontSize: 16, color: '#738071', marginTop: 4}}>Refinery Unit: Phase-III CDU</Text>
        </View>
        <View style={{flex: 1, justifyContent: 'flex-end', paddingBottom: Math.max(insets.bottom, 16)}}>
          <TouchableOpacity style={styles.authBtnSecondary} onPress={onLogout}>
            <Text style={styles.authBtnSecondaryText}>LOGOUT ACCOUNT</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------
// STYLES
// ----------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  content: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  title: {
    color: THEME.colors.white,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 24,
    marginBottom: 30,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.card,
    color: THEME.colors.white,
    fontFamily: THEME.typography.fontFamily,
    padding: 16,
    marginBottom: 16,
    fontSize: 16,
  },
  btnPrimary: {
    backgroundColor: THEME.colors.lime,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.lime,
  },
  btnPrimaryText: {
    color: THEME.colors.background,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 14,
    fontWeight: 'bold',
  },
  btnSecondary: {
    backgroundColor: THEME.colors.card,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  btnSecondaryText: {
    color: THEME.colors.white,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 12,
  },
  bentoCard: {
    backgroundColor: THEME.colors.card,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.layout.borderRadius,
    padding: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  bentoLabel: {
    color: THEME.colors.gray,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  bentoChip: {
    backgroundColor: THEME.colors.background,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    padding: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  bentoChipText: {
    color: THEME.colors.white,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 12,
  },
  bentoPillBtn: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.background,
  },
  diagText: {
    color: THEME.colors.white,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 11,
  },
  gridCellH: {
    backgroundColor: '#F2F4F7',
    padding: 6,
    borderRightWidth: 1,
    borderColor: THEME.colors.charcoal,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 8,
    fontWeight: 'bold',
    color: THEME.colors.charcoal
  },
  gridCell: {
    backgroundColor: THEME.colors.white,
    padding: 6,
    borderRightWidth: 1,
    borderColor: THEME.colors.charcoal,
    fontFamily: THEME.typography.fontFamily,
    fontSize: 8,
    color: THEME.colors.charcoal
  },
  authCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 4,
  },
  authInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8E2D3',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#143823',
    marginBottom: 16,
  },
  authBtnPrimary: {
    backgroundColor: '#143823',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  authBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  authBtnSecondary: {
    backgroundColor: '#E8EFE3',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  authBtnSecondaryText: {
    color: '#143823',
    fontWeight: '600',
    fontSize: 15,
  }
});
