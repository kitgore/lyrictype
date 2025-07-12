import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

// Initialize Firebase using centralized config
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testFirestoreConnection() {
    console.log('🧪 Testing Firestore connection...\n');
    
    try {
        // Test data
        const testArtists = [
            {
                id: "test-artist-1",
                name: "Test Artist One",
                url: "https://genius.com/artists/test-artist-1",
                geniusId: "123456",
                type: "popular",
                searchTokens: ["t", "te", "tes", "test", "test ", "test a", "test ar", "test art", "test arti", "test artis", "test artist", "Test Artist One"],
                nameForSorting: "test artist one",
                firstLetter: "t",
                uploadedAt: new Date()
            },
            {
                id: "test-artist-2", 
                name: "Another Test",
                url: "https://genius.com/artists/another-test",
                geniusId: "789012",
                type: "regular",
                searchTokens: ["a", "an", "ano", "anot", "anoth", "anothe", "another", "another ", "another t", "another te", "another tes", "another test", "Another Test"],
                nameForSorting: "another test",
                firstLetter: "a",
                uploadedAt: new Date()
            }
        ];
        
        const artistsCollection = collection(db, 'artists');
        
        console.log('📤 Uploading test artists...');
        
        for (const artist of testArtists) {
            const docRef = doc(artistsCollection, artist.id);
            const { id, ...documentData } = artist;
            
            await setDoc(docRef, documentData);
            console.log(`✅ Uploaded: ${artist.name} (ID: ${artist.id})`);
        }
        
        console.log('\n🎉 Test upload successful!');
        console.log('✅ Firestore connection is working');
        console.log('✅ Artist documents created successfully');
        console.log('✅ Search tokens generated');
        
        console.log('\n📋 Next steps:');
        console.log('1. Check Firebase Console to see the uploaded test data');
        console.log('2. Run the full upload script: node upload-to-firestore.js');
        console.log('3. Consider setting up proper Firestore security rules');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Make sure Firestore is enabled in Firebase Console');
        console.log('2. Check that Firestore rules allow writes');
        console.log('3. Verify your Firebase project configuration');
        
        throw error;
    }
}

// Run the test
testFirestoreConnection(); 